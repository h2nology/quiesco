/**
 * iOS Simulator via `xcrun simctl` (requirements.md §6.9; docs/spikes/05, Phase 4.0 findings).
 * - boot: pick the simulator (udid > name + os > the booted one), boot it if needed and wait for
 *   `simctl bootstatus -b` (a launch sent earlier is lost).
 * - launch: `simctl launch` with the connection parameters as `-key value` arguments (they land in
 *   UserDefaults' NSArgumentDomain, read by @quiesco/native). Dev clients get `--initialUrl <metro>`
 *   plus the expo-dev-menu switches as launch arguments: `--initialUrl` bypasses the launcher URL
 *   params (`__expo_disable_*`), but every dev-menu preference is read from UserDefaults, which the
 *   argument domain overrides.
 * - Parallel workers (worker.count > 1) each get their own simulator: `udids[N]`; or worker 0 uses the
 *   chosen simulator and worker N > 0 a simulator named "<name> (Quiesco N)" of the same device type
 *   and runtime, created with `simctl create` on first use and kept for later runs. (`simctl clone`
 *   would copy the base, but it refuses a booted source, and worker 0 is using it.)
 * - The simulator shares the Mac's network: no port forwarding.
 * - Device input: no system back button on iOS; deep links are opened inside the app by
 *   @quiesco/native, because `simctl openurl` shows a SpringBoard confirmation alert.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { LAUNCH_PARAM_PORT, LAUNCH_PARAM_SESSION } from '@quiesco/protocol';
import type { HostInput } from '@quiesco/protocol';

import type { IosAppConfig, IosDeviceConfig } from '../config.js';
import { QuiescoError } from '../errors.js';
import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';
import type { Exec } from './exec.js';
import { execCommand } from './exec.js';
import type { Permission } from './permissions.js';
import type { DeviceProvider, LaunchParams, WorkerInfo } from './provider.js';

/** `simctl privacy` services; camera and notifications have none (Xcode 27). */
const IOS_PRIVACY: Partial<Record<Permission, string[]>> = {
  microphone: ['microphone'],
  location: ['location'],
  contacts: ['contacts'],
  photos: ['photos'],
  calendar: ['calendar'],
};

/** Configuration-profile files holding the effective restrictions, relative to the simulator data directory. */
export const IOS_RESTRICTION_FILES: readonly string[] = [
  'Containers/Shared/SystemGroup/systemgroup.com.apple.configurationprofiles/Library/ConfigurationProfiles/UserSettings.plist',
  'Library/UserConfigurationProfiles/EffectiveUserSettings.plist',
  'Library/UserConfigurationProfiles/PublicInfo/PublicEffectiveUserSettings.plist',
];

/** expo-dev-menu preferences as launch arguments: no menu / onboarding / floating button at launch. */
export const IOS_DEV_MENU_ARGS: readonly string[] = [
  '-EXDevMenuShowsAtLaunch', 'NO',
  '-EXDevMenuIsOnboardingFinished', 'YES',
  '-EXDevMenuShowFloatingActionButton', 'NO',
  '-EXDevMenuDisableAutoLaunch', 'YES',
];

export interface SimDevice {
  udid: string;
  name: string;
  state: string;
  /** The simulator's data directory (`~/Library/Developer/CoreSimulator/Devices/<udid>/data`). */
  dataPath?: string;
  /** Runtime identifier, e.g. `com.apple.CoreSimulator.SimRuntime.iOS-27-0`. */
  runtime: string;
  /** Device type identifier, e.g. `com.apple.CoreSimulator.SimDeviceType.iPhone-17`. */
  deviceType?: string;
}

/** Name of the simulator parallel worker `index` (> 0) uses next to the base simulator `baseName`. */
export function workerSimulatorName(baseName: string, index: number): string {
  return `${baseName} (Quiesco ${index})`;
}

const WORKER_SIMULATOR = / \(Quiesco \d+\)$/;

export interface IosProviderOptions {
  app: IosAppConfig;
  device?: IosDeviceConfig;
  logger?: Logger;
  exec?: Exec;
  /** The parallel worker this provider serves. Default: the only worker. */
  worker?: WorkerInfo;
}

/** `27.0` / `iOS 27.0` / `27` → does the runtime identifier match? */
export function runtimeMatches(runtime: string, version: string): boolean {
  const v = version.replace(/^iOS\s*/i, '').trim().replace(/\./g, '-');
  return runtime.endsWith(`.iOS-${v}`) || runtime.includes(`.iOS-${v}-`);
}

/**
 * Choose a simulator: udid, else name (+ os), preferring a booted one; else the first booted one.
 * Simulators created for parallel workers are only chosen by udid.
 */
export function chooseSimulator(all: readonly SimDevice[], cfg: IosDeviceConfig): SimDevice {
  const devices = cfg.udid !== undefined ? all : all.filter((d) => !WORKER_SIMULATOR.test(d.name));
  const describe = (ds: readonly SimDevice[]): string => ds.map((d) => `${d.name} (${d.runtime.replace(/^.*SimRuntime\./, '')}, ${d.state})`).join(', ') || 'none';
  if (cfg.udid !== undefined) {
    const d = devices.find((x) => x.udid === cfg.udid);
    if (d === undefined) throw new QuiescoError('DEVICE_ERROR', `No available simulator with udid ${cfg.udid}`);
    return d;
  }
  if (cfg.device !== undefined) {
    const named = devices.filter((d) => d.name === cfg.device && (cfg.os === undefined || runtimeMatches(d.runtime, cfg.os)));
    if (named.length === 0) {
      throw new QuiescoError('DEVICE_ERROR', `No available simulator "${cfg.device}"${cfg.os !== undefined ? ` on iOS ${cfg.os}` : ''}. Available: ${describe(devices)}`);
    }
    return named.find((d) => d.state === 'Booted') ?? (named[named.length - 1] as SimDevice);
  }
  const booted = devices.filter((d) => d.state === 'Booted');
  if (booted.length === 0) throw new QuiescoError('DEVICE_ERROR', `No simulator is booted; set devices.ios.device (available: ${describe(devices)})`);
  return booted[0] as SimDevice;
}

export class IosProvider implements DeviceProvider {
  readonly platform = 'ios' as const;
  private sim: SimDevice | null = null;
  private bootedByUs = false;
  private readonly exec: Exec;
  private readonly logger: Logger;

  constructor(private readonly options: IosProviderOptions) {
    this.exec = options.exec ?? execCommand;
    this.logger = options.logger ?? silentLogger;
  }

  private get bundleId(): string {
    return this.options.app.bundleId;
  }

  private get udid(): string {
    if (this.sim === null) throw new QuiescoError('DEVICE_ERROR', 'iOS simulator not booted (call boot() first)');
    return this.sim.udid;
  }

  private async simctl(args: readonly string[], timeoutMs?: number): Promise<string> {
    const { stdout } = await this.exec('xcrun', ['simctl', ...args], timeoutMs === undefined ? {} : { timeoutMs });
    return stdout.toString();
  }

  /** Available simulators from `simctl list devices available --json`. */
  async devices(): Promise<SimDevice[]> {
    const json = JSON.parse(await this.simctl(['list', 'devices', 'available', '--json'])) as {
      devices: Record<string, { udid: string; name: string; state: string; dataPath?: string; deviceTypeIdentifier?: string; isAvailable?: boolean }[]>;
    };
    return Object.entries(json.devices).flatMap(([runtime, ds]) =>
      ds.map((d) => ({
        udid: d.udid,
        name: d.name,
        state: d.state,
        runtime,
        ...(d.dataPath !== undefined ? { dataPath: d.dataPath } : {}),
        ...(d.deviceTypeIdentifier !== undefined ? { deviceType: d.deviceTypeIdentifier } : {}),
      })),
    );
  }

  private get worker(): WorkerInfo {
    return this.options.worker ?? { index: 0, count: 1 };
  }

  /** The simulator this worker uses (see the file comment). */
  private async pickSimulator(cfg: IosDeviceConfig): Promise<SimDevice> {
    const worker = this.worker;
    const all = await this.devices();
    if (cfg.udids !== undefined && cfg.udids.length > 0) {
      const udid = cfg.udids[worker.index];
      if (udid === undefined) {
        throw new QuiescoError('DEVICE_ERROR', `devices.ios.udids lists ${cfg.udids.length} simulator(s), but this is worker ${worker.index} of ${worker.count}; add one udid per worker`);
      }
      return chooseSimulator(all, { udid });
    }
    if (worker.count > 1 && cfg.udid !== undefined) {
      throw new QuiescoError('CONFIG_ERROR', `devices.ios.udid pins one simulator, but ${worker.count} workers run in parallel; set devices.ios.udids (one per worker) or devices.ios.device`);
    }
    const base = chooseSimulator(all, cfg);
    if (worker.index === 0) return base;
    const name = workerSimulatorName(base.name, worker.index);
    const existing = all.find((d) => d.name === name && d.runtime === base.runtime);
    if (existing !== undefined) return existing;
    if (base.deviceType === undefined) throw new QuiescoError('DEVICE_ERROR', `Cannot tell the device type of ${base.name} to create "${name}"; set devices.ios.udids`);
    this.logger.info(`worker ${worker.index}: creating iOS simulator "${name}" (${base.deviceType.replace(/^.*SimDeviceType\./, '')}, ${base.runtime.replace(/^.*SimRuntime\./, '')})`);
    const udid = (await this.simctl(['create', name, base.deviceType, base.runtime])).trim();
    const created = (await this.devices()).find((d) => d.udid === udid);
    if (created === undefined) throw new QuiescoError('DEVICE_ERROR', `simctl create "${name}" did not produce an available simulator (got "${udid}")`);
    return created;
  }

  async boot(): Promise<void> {
    const cfg = this.options.device ?? {};
    this.sim = await this.pickSimulator(cfg);
    if (this.worker.count > 1) this.logger.info(`worker ${this.worker.index}: iOS simulator ${this.sim.name} (${this.sim.udid})`);
    const timeoutMs = cfg.bootTimeoutMs ?? 180_000;
    if (this.sim.state !== 'Booted') {
      this.logger.info(`booting iOS simulator ${this.sim.name} (${this.sim.udid})`);
      await this.simctl(['boot', this.sim.udid]).catch((e: unknown) => {
        // "Unable to boot device in current state: Booted" — booted meanwhile.
        if (!/current state: Booted/.test((e as Error).message)) throw e;
      });
      this.bootedByUs = true;
    }
    await this.simctl(['bootstatus', this.sim.udid, '-b'], timeoutMs).catch((e: unknown) => {
      throw new QuiescoError('DEVICE_ERROR', `iOS simulator ${this.sim?.name} did not finish booting within ${timeoutMs}ms: ${(e as Error).message}`);
    });
    if (cfg.disablePasswordAutoFill !== false) await this.disablePasswordAutoFill();
  }

  /**
   * Turn off password AutoFill on the simulator, as the MDM restriction `allowPasswordAutoFill` does.
   * Otherwise submitting a form with a secure text field makes iOS show its "Save Password?" sheet in a
   * system window above the app, which no app reset dismisses: every later touch is obscured. App-side
   * `textContentType` / `autoComplete` do not prevent it (iOS 27). Takes effect without a reboot.
   */
  private async disablePasswordAutoFill(): Promise<void> {
    const data = this.sim?.dataPath;
    if (data === undefined) {
      this.logger.warn('cannot find the simulator data directory; password AutoFill stays on (iOS may show "Save Password?" sheets)');
      return;
    }
    for (const rel of IOS_RESTRICTION_FILES) {
      const file = path.join(data, rel);
      await this.exec('plutil', ['-replace', 'restrictedBool.allowPasswordAutoFill.value', '-bool', 'NO', file]).catch((e: unknown) =>
        this.logger.debug(`password AutoFill: ${rel} not updated (${(e as Error).message})`),
      );
    }
  }

  async install(): Promise<void> {
    const app = this.options.app.binaryPath;
    if (app !== undefined) {
      await this.simctl(['install', this.udid, path.resolve(app)], 300_000);
      return;
    }
    try {
      await this.simctl(['get_app_container', this.udid, this.bundleId]);
    } catch {
      throw new QuiescoError('DEVICE_ERROR', `${this.bundleId} is not installed on ${this.sim?.name}; set apps.ios.binaryPath or install the dev client first`);
    }
  }

  async launch(params: LaunchParams): Promise<void> {
    const dc = this.options.app.devClient;
    const args = ['launch', '--terminate-running-process', this.udid, this.bundleId];
    if (dc !== undefined) args.push('--initialUrl', dc.metroUrl ?? 'http://localhost:8081', ...IOS_DEV_MENU_ARGS);
    args.push(`-${LAUNCH_PARAM_PORT}`, String(params.port), `-${LAUNCH_PARAM_SESSION}`, params.sessionId);
    await this.simctl(args).catch((e: unknown) => {
      throw new QuiescoError('DEVICE_ERROR', `simctl launch failed: ${(e as Error).message}`);
    });
  }

  async terminate(): Promise<void> {
    // Fails when the app is not running; that is the state we want.
    await this.simctl(['terminate', this.udid, this.bundleId]).catch(() => undefined);
  }

  async grantPermissions(perms: readonly Permission[]): Promise<void> {
    for (const p of perms) {
      const services = IOS_PRIVACY[p];
      if (services === undefined) {
        this.logger.warn(`permission "${p}" cannot be pre-granted on the iOS simulator (simctl privacy has no such service); skipped`);
        continue;
      }
      for (const s of services) {
        await this.simctl(['privacy', this.udid, 'grant', s, this.bundleId]).catch((e: unknown) =>
          this.logger.warn(`cannot grant ${s} on iOS: ${(e as Error).message}`),
        );
      }
    }
  }

  async screenshot(): Promise<Buffer> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quiesco-ios-'));
    const file = path.join(dir, 'screen.png');
    try {
      await this.simctl(['io', this.udid, 'screenshot', '--type=png', file]);
      return await fs.readFile(file);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  async injectInput(input: HostInput): Promise<void> {
    switch (input.kind) {
      case 'back':
        throw new QuiescoError('ACTION_NOT_SUPPORTED', 'pressBack is not available on iOS: there is no system back button', {
          action: 'pressBack',
          platform: 'ios',
          hint: 'tap the app\'s own back control instead (e.g. the navigation bar back button), or tag the scenario @android',
        });
      case 'navigate':
        throw new QuiescoError(
          'ACTION_NOT_SUPPORTED',
          `openUrl on iOS needs @quiesco/native in the app: \`simctl openurl\` shows a system confirmation alert that cannot be dismissed`,
          { action: 'openUrl', platform: 'ios', hint: 'build the app with EXPO_PUBLIC_QUIESCO=1 and @quiesco/expo-plugin, so @quiesco/native opens the URL inside the app' },
        );
      default:
        throw new QuiescoError(
          'ACTION_NOT_SUPPORTED',
          `Real ${input.kind} input on iOS needs @quiesco/native in the app (an e2e build with @quiesco/expo-plugin); or set actions: { mode: 'js' }`,
          { action: input.kind, platform: 'ios', hint: 'add @quiesco/native to the app and rebuild it with EXPO_PUBLIC_QUIESCO=1' },
        );
    }
  }

  async shutdown(): Promise<void> {
    if (this.sim === null) return;
    if (this.bootedByUs && this.options.device?.shutdown === true) await this.simctl(['shutdown', this.sim.udid]).catch(() => undefined);
  }

  async diagnose(params: LaunchParams): Promise<string[]> {
    const lines = [`The simulator shares the Mac's network: the app connects to ws://localhost:${params.port} directly.`];
    const services = await this.simctl(['spawn', this.udid, 'launchctl', 'list']).catch(() => '');
    lines.push(
      services.includes(`UIKitApplication:${this.bundleId}`)
        ? `${this.bundleId} is running on ${this.sim?.name}.`
        : `${this.bundleId} is NOT running on ${this.sim?.name} — did it crash on start? Check \`xcrun simctl spawn ${this.udid} log show --last 2m --style compact --predicate 'subsystem BEGINSWITH "${this.bundleId}" OR messageType == fault'\` or the Simulator crash reports.`,
    );
    return lines;
  }
}
