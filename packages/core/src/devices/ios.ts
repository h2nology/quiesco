/**
 * iOS Simulator via `xcrun simctl` (requirements.md §6.9; docs/spikes/05, Phase 4.0 findings).
 * - boot: pick the simulator (udid > name + os > the booted one), boot it if needed and wait for
 *   `simctl bootstatus -b` (a launch sent earlier is lost).
 * - launch: `simctl launch` with the connection parameters as `-key value` arguments (they land in
 *   UserDefaults' NSArgumentDomain, read by @quiesco/native). Dev clients get `--initialUrl <metro>`
 *   plus the expo-dev-menu switches as launch arguments: `--initialUrl` bypasses the launcher URL
 *   params (`__expo_disable_*`), but every dev-menu preference is read from UserDefaults, which the
 *   argument domain overrides.
 * - The simulator shares the Mac's network: no port forwarding.
 * - Device input: no system back button on iOS; deep links are opened inside the app by
 *   @quiesco/native, because `simctl openurl` shows a SpringBoard confirmation alert.
 * - Parallel workers (Phase 6.12): `udids[N]`; or worker 0 uses the chosen simulator and worker N > 0 one
 *   named "<name> (Quiesco N)" with the base's device type and runtime (both must match: the same name
 *   exists once per runtime), created with `simctl create` on first use and kept. `simctl clone` refuses a
 *   booted source. Without `binaryPath`, a worker copies the app installed on the base simulator.
 * - Phase 6.5: launch arguments as `-quiescoArgs <base64 JSON>`; a launch URL as `-quiescoUrl`, which
 *   @quiesco/native hands to expo-linking; background = `-[UIApplication suspend]` inside the app (home
 *   screen), or opening the Settings app for apps without @quiesco/native; foreground = `simctl launch`
 *   without terminating (the running process is activated, its arguments are ignored).
 */
import { newestIosCrash } from './crash.js';
import type { CrashReport } from './crash.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { LAUNCH_PARAM_ARGS, LAUNCH_PARAM_PORT, LAUNCH_PARAM_SESSION, LAUNCH_PARAM_URL } from '@quiesco/protocol';
import type { HostInput, Orientation } from '@quiesco/protocol';

import type { IosAppConfig, IosDeviceConfig } from '../config.js';
import { QuiescoError } from '../errors.js';
import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';
import type { Exec } from './exec.js';
import { execCommand } from './exec.js';
import { LogBuffer, exited, spawnProcess } from './streams.js';
import type { ChildLike, SpawnProcess } from './streams.js';
import { IosSystemRunner, PERMISSION_ALLOW, PERMISSION_DENY, backButton, dismissButton, screenNodes } from './ios-runner.js';
import type { RunnerScreen } from './ios-runner.js';
import type { Permission } from './permissions.js';
import { SERIAL_WORKER } from './provider.js';
import type { ColorScheme, DeviceProvider, InAppControls, LaunchParams, LaunchUrlHandling, NotificationSpec, StateChange, StatusBarOptions, SystemNode, WorkerInfo } from './provider.js';

/** `simctl privacy` services; camera and notifications have none (Xcode 27). */
const IOS_PRIVACY: Partial<Record<Permission, string[]>> = {
  microphone: ['microphone'],
  location: ['location'],
  contacts: ['contacts'],
  photos: ['photos'],
  calendar: ['calendar'],
};

/**
 * Dynamic Type sizes (`simctl ui content_size`) and the font scale React Native reports for each
 * (RCTAccessibilityManager.mm `multipliers`, RN 0.88).
 */
export const IOS_CONTENT_SIZES: readonly (readonly [string, number])[] = [
  ['extra-small', 0.823],
  ['small', 0.882],
  ['medium', 0.941],
  ['large', 1.0],
  ['extra-large', 1.118],
  ['extra-extra-large', 1.235],
  ['extra-extra-extra-large', 1.353],
  ['accessibility-medium', 1.786],
  ['accessibility-large', 2.143],
  ['accessibility-extra-large', 2.643],
  ['accessibility-extra-extra-large', 3.143],
  ['accessibility-extra-extra-extra-large', 3.571],
];

/** The Dynamic Type size whose font scale is nearest to `scale`. */
export function nearestContentSize(scale: number): readonly [string, number] {
  let best = IOS_CONTENT_SIZES[3] as readonly [string, number];
  for (const c of IOS_CONTENT_SIZES) if (Math.abs(c[1] - scale) < Math.abs(best[1] - scale)) best = c;
  return best;
}

/** `ja-JP` → `-AppleLanguages (ja-JP) -AppleLocale ja_JP` launch arguments. */
export function iosLocaleArgs(locale: string): string[] {
  return ['-AppleLanguages', `(${locale})`, '-AppleLocale', locale.replace(/-/g, '_')];
}

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
  // A shake (app.device.shake()) would open the dev menu over the app; the app's own shake handlers
  // (RCTShowDevMenuNotification) still get it (Phase 6.7).
  '-EXDevMenuMotionGestureEnabled', 'NO',
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

/** Simulators Quiesco created for parallel workers (`quiesco devices --prune` removes them). */
export const WORKER_SIMULATOR = / \(Quiesco \d+\)$/;

const shortRuntime = (runtime: string): string => runtime.replace(/^.*SimRuntime\./, '');
const shortType = (type: string | undefined): string => (type ?? 'unknown type').replace(/^.*SimDeviceType\./, '');

export interface IosProviderOptions {
  app: IosAppConfig;
  device?: IosDeviceConfig;
  logger?: Logger;
  exec?: Exec;
  /** Where the built system UI runner is cached (default ~/Library/Caches/quiesco/ios-runner). */
  runnerCacheDir?: string;
  /** The system UI runner (tests). Default: the XCUITest runner on the session's simulator. */
  systemRunner?: SystemRunnerLike;
  /** Long-running processes: recordVideo, log stream (tests). */
  spawnProcess?: SpawnProcess;
  /** The parallel worker this provider serves (Phase 6.12). Default: the only worker. */
  worker?: WorkerInfo;
  /** How long match() / fail() wait for the app's authentication to start (tests). Default 10 s. */
  biometricWaitMs?: number;
  /** Where crash reports are written (tests). Default ~/Library/Logs/DiagnosticReports. */
  crashReportDir?: string;
  /** How long crashReport() waits for the report to appear (tests). Default 5 s. */
  crashReportWaitMs?: number;
}

/** What IosProvider uses of IosSystemRunner. */
export type SystemRunnerLike = Pick<IosSystemRunner, 'running' | 'screen' | 'tap' | 'openNotificationCenter' | 'stop'> & Partial<Pick<IosSystemRunner, 'navigationBar' | 'edgeSwipeBack' | 'elements' | 'typeText' | 'appState' | 'start'>>;

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

/**
 * coreauthd's log lines (Phase 6.12, findings): a Face ID / Touch ID match starts after the system sheet
 * appeared ("…Mechanism…(run) will start matching user N"), and the simulator's match / no-match lands as
 * "-[BKMatchOperation simulateMatching:type:]". A notification posted before the match started is lost.
 */
export const BIOMETRIC_LOG_PREDICATE = 'process == "coreauthd" AND (eventMessage CONTAINS "will start matching" OR eventMessage CONTAINS "simulateMatching")';

/** Whether a match is waiting after these coreauthd lines (oldest first): the last start is newer than the last answer. */
export function biometricPending(lines: readonly string[], pending = false): boolean {
  let p = pending;
  for (const l of lines) {
    if (l.includes('will start matching')) p = true;
    else if (l.includes('simulateMatching')) p = false;
  }
  return p;
}

/** How long match() / fail() wait for the app's authentication to start before posting anyway. */
const BIOMETRIC_WAIT_MS = 10_000;
/** While waiting, how often the log is read back too (a `log stream` misses what happens while it attaches). */
const BIOMETRIC_RECHECK_MS = 1_000;

/** `log show --start` takes the simulator's local time: `YYYY-MM-DD HH:MM:SS`. */
export function logTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Apps whose UI system.* sees when they are in front (issue #51): the page of a web authentication session
 * (ASWebAuthenticationSession, SFSafariViewController) and Safari.
 */
const OTHER_APPS = ['com.apple.SafariViewService', 'com.apple.mobilesafari'];
/** XCUIApplication.State.runningForeground. */
const RUNNING_FOREGROUND = 4;
/** XCUIElement.ElementType values left out: the application, windows, scroll bars (no one taps them). */
const SKIPPED_TYPES = new Set([2, 4, 47]);
/** searchField, textField, secureTextField, textView. */
const FIELD_TYPES = new Set([45, 49, 50, 52]);

/** SystemNodes of a runner element tree (`/elements`): the label, else the value (a field's text). */
export function uikitNodes(elements: readonly { type: number; label: string; id: string; value: string; frame: number[] }[], app: string): SystemNode[] {
  return elements
    .filter((e) => !SKIPPED_TYPES.has(e.type) && (e.frame[2] ?? 0) > 0 && (e.frame[3] ?? 0) > 0)
    .map((e) => {
      const [x = 0, y = 0, w = 0, h = 0] = e.frame;
      return { text: e.label !== '' ? e.label : e.value, id: e.id, bounds: { x1: x, y1: y, x2: x + w, y2: y + h }, app, ...(FIELD_TYPES.has(e.type) ? { field: true } : {}) };
    });
}

/**
 * Whether `frame` ([x, y, w, h]) looks like the "Open" button a locked device (or iOS 27 Notification Center, #82) shows beside the tapped
 * notification `b`: in its row, on its left, less than half its width.
 */
function revealedOpen(frame: number[], b: { x1: number; x2: number; y1: number; y2: number }): boolean {
  const [x = 0, y = 0, w = 0, h = 0] = frame;
  const mid = y + h / 2;
  return mid >= b.y1 && mid <= b.y2 && x + w / 2 < (b.x1 + b.x2) / 2 && w < (b.x2 - b.x1) / 2;
}

/** Darwin notification state BiometricKit_Sim reads for "enrolled" (1 / 0). */
const BIOMETRIC_ENROLLMENT = 'com.apple.BiometricKit.enrollmentChanged';

/** openNotification: after BANNER_WAIT_MS (at most half the timeout) without a banner, it looks in Notification Center. */
const BANNER_WAIT_MS = 2_000;
const NOTIFICATION_POLL_MS = 250;
/** System UI slides in for ~430–615 ms: two reads this far apart must agree before a touch (issue #87). */
const SYSTEM_UI_SETTLE_MS = 250;
/** openUrlFromOutside: how long SpringBoard's "Open in …?" confirmation may take to show up. */
const OPEN_URL_CONFIRM_MS = 5_000;
/**
 * After tapping a notification: how long the app may take to come to the front (or, with a runner that
 * cannot tell, the notification to go away) before Quiesco looks again, and how many taps it makes.
 */
const NOTIFICATION_TAP_CONFIRM_MS = 1_500;
/** The same for a runner that reads the app's state: an app resuming from suspension may take a moment. */
const NOTIFICATION_FRONT_MS = 3_000;
const NOTIFICATION_TAPS = 3;

export class IosProvider implements DeviceProvider {
  readonly platform = 'ios' as const;
  /**
   * UIPinchGestureRecognizer / UIRotationGestureRecognizer (also behind react-native-gesture-handler on
   * iOS) report from where they activate; measured on iOS 27 (Phase 6.4): about 9 pt and 7°.
   */
  readonly gestureSlop = { pinch: 9, rotation: (7 * Math.PI) / 180 };
  private sim: SimDevice | null = null;
  private bootedByUs = false;
  /** Locale the app is launched with (setLocale); null = the simulator's. */
  private locale: string | null = null;
  /** Device settings changed by setX, with the value to restore (resetDeviceState). */
  private readonly changed = new Map<'appearance' | 'biometrics' | 'contentSize' | 'location' | 'orientation' | 'statusBar', string>();
  private readonly exec: Exec;
  private readonly logger: Logger;
  /** XCUITest runner for SpringBoard's UI, started on first use (Phase 6.7 batch C). */
  private runnerInstance: SystemRunnerLike | null = null;
  /** A runner start in progress: a warm-up (sendToBackground) and a system UI call share it. */
  private runnerStarting: Promise<void> | null = null;
  /** Phase 6.9 artifacts: the running recorder and log stream. */
  private recorder: { child: ChildLike; file: string } | null = null;
  private logStream: ChildLike | null = null;
  /** coreauthd's match starts and answers (Phase 6.12): whether an authentication is waiting for a face / finger. */
  private biometricWatch: { child: ChildLike; pending: boolean; since: number } | null = null;
  private readonly logs = new LogBuffer();

  constructor(private readonly options: IosProviderOptions) {
    this.exec = options.exec ?? execCommand;
    this.logger = options.logger ?? silentLogger;
  }

  private get bundleId(): string {
    return this.options.app.bundleId;
  }

  private get worker(): WorkerInfo {
    return this.options.worker ?? SERIAL_WORKER;
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

  /** The base simulator (worker 0's) when this worker uses another one; for copying the app. */
  private base: SimDevice | null = null;

  /** The simulator this worker uses (see the file comment). */
  private async pickSimulator(cfg: IosDeviceConfig): Promise<SimDevice> {
    const worker = this.worker;
    const all = await this.devices();
    if (cfg.udids !== undefined && cfg.udids.length > 0) {
      const udid = cfg.udids[worker.index];
      if (udid === undefined) {
        throw new QuiescoError('CONFIG_ERROR', `devices.ios.udids lists ${cfg.udids.length} simulator(s), but this is worker ${worker.index} of ${worker.count}; list one udid per worker`);
      }
      const listed = cfg.udids.map((u) => all.find((d) => d.udid === u)).filter((d): d is SimDevice => d !== undefined);
      const kinds = new Set(listed.map((d) => `${shortType(d.deviceType)} / ${shortRuntime(d.runtime)}`));
      if (worker.index === 0 && kinds.size > 1) {
        this.logger.warn(`devices.ios.udids mixes ${[...kinds].join(', ')}: a scenario may pass on one worker and fail on another (parallel workers should be identical)`);
      }
      return chooseSimulator(all, { udid });
    }
    if (worker.count > 1 && cfg.udid !== undefined) {
      throw new QuiescoError('CONFIG_ERROR', `devices.ios.udid pins one simulator, but ${worker.count} workers run in parallel; set devices.ios.udids (one per worker) or devices.ios.device`);
    }
    const base = chooseSimulator(all, cfg);
    if (worker.index === 0) return base;
    this.base = base;
    const name = workerSimulatorName(base.name, worker.index);
    // Same name, device type and runtime: "iPhone 17 (Quiesco 1)" exists once per runtime.
    const existing = all.find((d) => d.name === name && d.runtime === base.runtime && (base.deviceType === undefined || d.deviceType === base.deviceType));
    if (existing !== undefined) return existing;
    if (base.deviceType === undefined) throw new QuiescoError('DEVICE_ERROR', `Cannot tell the device type of ${base.name} to create "${name}"; set devices.ios.udids`);
    this.logger.info(`worker ${worker.index}: creating iOS simulator "${name}" (${shortType(base.deviceType)}, ${shortRuntime(base.runtime)})`);
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
    if (this.base !== null) {
      // A worker simulator: install what the base simulator has (a dev client installed by hand), every
      // session, so a rebuilt app reaches the workers too.
      const source = await this.installedApp(this.base);
      await this.simctl(['install', this.udid, source], 300_000);
      return;
    }
    try {
      await this.simctl(['get_app_container', this.udid, this.bundleId]);
    } catch {
      throw new QuiescoError('DEVICE_ERROR', `${this.bundleId} is not installed on ${this.sim?.name}; set apps.ios.binaryPath or install the dev client first`);
    }
  }

  /**
   * The `.app` of this bundle installed on `sim`: `simctl get_app_container` (booted simulators), else
   * found in its data directory by the bundle id in each app's Info.plist.
   */
  private async installedApp(sim: SimDevice): Promise<string> {
    const missing = (): QuiescoError =>
      new QuiescoError('DEVICE_ERROR', `${this.bundleId} is not installed on the base simulator ${sim.name} (${shortRuntime(sim.runtime)}), so worker ${this.worker.index} cannot copy it; set apps.ios.binaryPath or install the app there first`);
    if (sim.state === 'Booted') {
      const p = (await this.simctl(['get_app_container', sim.udid, this.bundleId, 'app']).catch(() => '')).trim();
      if (p !== '') return p;
      throw missing();
    }
    if (sim.dataPath === undefined) throw missing();
    const root = path.join(sim.dataPath, 'Containers/Bundle/Application');
    for (const container of await fs.readdir(root).catch(() => [] as string[])) {
      for (const entry of await fs.readdir(path.join(root, container)).catch(() => [] as string[])) {
        if (!entry.endsWith('.app')) continue;
        const app = path.join(root, container, entry);
        const id = await this.exec('plutil', ['-extract', 'CFBundleIdentifier', 'raw', path.join(app, 'Info.plist')]).then(
          (r) => r.stdout.toString().trim(),
          () => '',
        );
        if (id === this.bundleId) return app;
      }
    }
    throw missing();
  }

  async launch(params: LaunchParams): Promise<LaunchUrlHandling | void> {
    const dc = this.options.app.devClient;
    const args = ['launch', '--terminate-running-process', this.udid, this.bundleId];
    if (dc !== undefined) args.push('--initialUrl', dc.metroUrl ?? 'http://localhost:8081', ...IOS_DEV_MENU_ARGS);
    args.push(`-${LAUNCH_PARAM_PORT}`, String(params.port), `-${LAUNCH_PARAM_SESSION}`, params.sessionId);
    if (params.args !== undefined) args.push(`-${LAUNCH_PARAM_ARGS}`, params.args);
    if (params.url !== undefined) args.push(`-${LAUNCH_PARAM_URL}`, params.url);
    if (this.locale !== null) args.push(...iosLocaleArgs(this.locale));
    await this.simctl(args).catch((e: unknown) => {
      throw new QuiescoError('DEVICE_ERROR', `simctl launch failed: ${(e as Error).message}`);
    });
    if (params.url !== undefined) return 'needs-native';
  }

  async terminate(): Promise<void> {
    // Fails when the app is not running; that is the state we want.
    await this.simctl(['terminate', this.udid, this.bundleId]).catch(() => undefined);
  }

  /**
   * Empty the app's data container (Documents, Library, tmp) and its UserDefaults. UserDefaults go through
   * `defaults delete` first: cfprefsd caches them, so deleting the plist alone would bring them back.
   * The keychain is kept (simctl cannot clear one app's keychain items).
   */
  async clearData(): Promise<void> {
    await this.terminate();
    await this.simctl(['spawn', this.udid, 'defaults', 'delete', this.bundleId]).catch(() => undefined);
    let data: string;
    try {
      data = (await this.simctl(['get_app_container', this.udid, this.bundleId, 'data'])).trim();
    } catch (e) {
      throw new QuiescoError('DEVICE_ERROR', `cannot find the data container of ${this.bundleId}: ${(e as Error).message}`);
    }
    for (const dir of ['Documents', 'Library', 'tmp']) {
      const full = path.join(data, dir);
      const entries = await fs.readdir(full).catch(() => [] as string[]);
      for (const name of entries) await fs.rm(path.join(full, name), { recursive: true, force: true });
    }
  }

  async uninstall(): Promise<void> {
    await this.terminate();
    await this.simctl(['uninstall', this.udid, this.bundleId]);
  }

  async sendToBackground(app: InAppControls): Promise<void> {
    // What follows is often openNotification: a runner that starts only then (7–15 s cold) misses the
    // banner (issue #82). Started in the background; a failure shows up when the runner is used.
    this.startRunner().catch((e: unknown) => this.logger.debug(`warming up the iOS system UI runner failed: ${(e as Error).message}`));
    if (await app.suspend().catch(() => false)) return;
    // No @quiesco/native (or an older one): another app in front puts ours in the background too.
    this.logger.debug('sendToBackground: the app cannot suspend itself; opening the Settings app instead');
    await this.simctl(['launch', this.udid, 'com.apple.Preferences']);
  }

  async bringToForeground(): Promise<void> {
    await this.simctl(['launch', this.udid, this.bundleId]).catch((e: unknown) => {
      throw new QuiescoError('DEVICE_ERROR', `simctl launch failed: ${(e as Error).message}`);
    });
  }

  // ---- Phase 6.6 device state ----

  /** simctl cannot rotate: the app's window scene is rotated by @quiesco/native. */
  async setOrientation(orientation: Orientation, app: InAppControls): Promise<void> {
    const r = await app.setOrientation(orientation);
    if (!r.supported) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', 'setOrientation on iOS needs @quiesco/native ≥ Phase 6.6 in the app (simctl cannot rotate)', {
        action: 'setOrientation',
        platform: 'ios',
        hint: 'rebuild the app with EXPO_PUBLIC_QUIESCO=1 and @quiesco/expo-plugin',
      });
    }
    if (r.error !== undefined) {
      throw new QuiescoError('DEVICE_ERROR', `iOS refused to rotate the app to ${orientation}: ${r.error} (does the app allow it? app.json "orientation": "default")`);
    }
    if (!this.changed.has('orientation')) this.changed.set('orientation', 'portrait');
  }

  async setLocation(location: { latitude: number; longitude: number }): Promise<void> {
    await this.simctl(['location', this.udid, 'set', `${location.latitude},${location.longitude}`]);
    this.changed.set('location', 'clear');
  }

  async setPermission(permission: Permission, grant: boolean): Promise<StateChange> {
    const services = IOS_PRIVACY[permission];
    if (services === undefined) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', `the "${permission}" permission cannot be changed on the iOS simulator (simctl privacy has no such service)`, {
        action: 'setPermission',
        platform: 'ios',
      });
    }
    for (const svc of services) await this.simctl(['privacy', this.udid, grant ? 'grant' : 'revoke', svc, this.bundleId]);
    // The simulator keeps the app running when a permission is revoked (spike 6.6).
    return { relaunch: false };
  }

  /**
   * `simctl privacy reset` (the app keeps running). Permissions simctl has no service for (notifications,
   * camera) are only reset by reinstalling the app: the caller does that.
   */
  async resetPermission(permission: Permission): Promise<StateChange> {
    const services = IOS_PRIVACY[permission];
    if (services === undefined) return { relaunch: true, reinstall: true };
    for (const svc of services) await this.simctl(['privacy', this.udid, 'reset', svc, this.bundleId]);
    return { relaunch: false };
  }

  async setAppearance(scheme: ColorScheme): Promise<void> {
    if (!this.changed.has('appearance')) this.changed.set('appearance', await this.current('appearance', 'light'));
    await this.simctl(['ui', this.udid, 'appearance', scheme]);
  }

  async setFontScale(scale: number): Promise<StateChange & { scale: number }> {
    const [size, applied] = nearestContentSize(scale);
    if (!this.changed.has('contentSize')) this.changed.set('contentSize', await this.current('content_size', 'large'));
    await this.simctl(['ui', this.udid, 'content_size', size]);
    return { scale: applied, relaunch: false }; // applied live
  }

  /** Applied at launch (`-AppleLanguages`): the app is started again. It must declare the language (CFBundleLocalizations). */
  async setLocale(locale: string | null): Promise<StateChange> {
    const changed = this.locale !== locale;
    this.locale = locale;
    return { relaunch: changed };
  }

  async setStatusBar(o: StatusBarOptions): Promise<void> {
    const args = ['status_bar', this.udid, 'override'];
    if (o.time !== undefined) args.push('--time', o.time);
    if (o.batteryLevel !== undefined) args.push('--batteryLevel', String(o.batteryLevel));
    if (o.charging !== undefined) args.push('--batteryState', o.charging ? 'charging' : 'discharging');
    if (o.wifiBars !== undefined) args.push('--wifiMode', 'active', '--wifiBars', String(o.wifiBars));
    if (o.cellularBars !== undefined) args.push('--cellularMode', 'active', '--cellularBars', String(o.cellularBars));
    if (o.dataNetwork !== undefined) args.push('--dataNetwork', o.dataNetwork);
    this.changed.set('statusBar', 'clear');
    await this.simctl(args);
  }

  async resetStatusBar(): Promise<void> {
    await this.simctl(['status_bar', this.udid, 'clear']);
    this.changed.delete('statusBar');
  }

  /**
   * Written by @quiesco/native inside the app: after `simctl pbcopy` iOS asks the user before the app may
   * read the text (spike 6.6), and the read hangs until someone answers.
   */
  async setClipboard(text: string, app: InAppControls): Promise<void> {
    const r = await app.setClipboard(text);
    if (!r.supported) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', 'clipboard.set on iOS needs @quiesco/native ≥ Phase 6.6 in the app (text from simctl pbcopy makes iOS ask the user before the app may paste it)', {
        action: 'clipboard.set',
        platform: 'ios',
        hint: 'rebuild the app with EXPO_PUBLIC_QUIESCO=1 and @quiesco/expo-plugin',
      });
    }
  }

  /** Through the app when it can; else `simctl pbpaste` (reading from the Mac asks nobody). */
  async getClipboard(app: InAppControls): Promise<string> {
    const r = await app.getClipboard();
    if (r.supported) return r.text ?? '';
    return this.simctl(['pbpaste', this.udid]);
  }

  // ---- Phase 6.7 system integration (Darwin notifications inside the simulator; findings 6.7) ----

  /** `notifyutil` run inside the simulator, where BiometricKit_Sim and UIKit listen. */
  private notify(...args: string[]): Promise<string> {
    return this.simctl(['spawn', this.udid, 'notifyutil', ...args]);
  }

  /**
   * Follow coreauthd's match starts (a `log stream`). Started with enroll(), before the app asks; started
   * later (by match() / fail()), it first reads the last few seconds of the log.
   */
  private async watchBiometrics(): Promise<{ child: ChildLike; pending: boolean; since: number }> {
    if (this.biometricWatch !== null && this.biometricWatch.child.exitCode === null) return this.biometricWatch;
    const child = (this.options.spawnProcess ?? spawnProcess)('xcrun', ['simctl', 'spawn', this.udid, 'log', 'stream', '--style', 'compact', '--predicate', BIOMETRIC_LOG_PREDICATE]);
    // `since`: where read-backs start (a second early: log times have whole seconds in --start).
    const watch = { child, pending: false, since: Date.now() - 20_000 };
    const lines = new LogBuffer(50);
    child.stdout?.on('data', (d) => {
      const before = Date.now();
      lines.write(d);
      watch.pending = biometricPending(lines.since(before), watch.pending);
    });
    this.biometricWatch = watch;
    if (!watch.pending) watch.pending = await this.biometricPendingInLog(watch.since);
    return watch;
  }

  /** Read the log back from `since`: is a match waiting? (Lines the stream delivered meanwhile win.) */
  private async biometricPendingInLog(since: number): Promise<boolean> {
    const out = await this.simctl(['spawn', this.udid, 'log', 'show', '--start', logTime(since - 1000), '--style', 'compact', '--predicate', BIOMETRIC_LOG_PREDICATE]).catch(() => '');
    return biometricPending(out.split('\n'));
  }

  async setBiometricEnrollment(enrolled: boolean): Promise<{ leftApp: boolean }> {
    if (enrolled) await this.watchBiometrics();
    if (!this.changed.has('biometrics')) this.changed.set('biometrics', /\s(\d+)\s*$/.exec(await this.notify('-g', BIOMETRIC_ENROLLMENT).catch(() => ''))?.[1] ?? '0');
    await this.setEnrollment(enrolled ? '1' : '0');
    return { leftApp: false };
  }

  private async setEnrollment(value: string): Promise<void> {
    await this.notify('-s', BIOMETRIC_ENROLLMENT, value);
    await this.notify('-p', BIOMETRIC_ENROLLMENT);
  }

  /** Face ID (`pearl`) and Touch ID (`fingerTouch`): the simulator's model only listens to its own kind. */
  async presentBiometric(match: boolean): Promise<void> {
    const outcome = match ? 'match' : 'nomatch';
    // Wait until the app's authentication is actually matching (under load the sheet takes seconds).
    const watch = await this.watchBiometrics();
    const waitMs = this.options.biometricWaitMs ?? BIOMETRIC_WAIT_MS;
    const deadline = Date.now() + waitMs;
    let recheck = Date.now() + 200;
    while (!watch.pending && Date.now() < deadline) {
      if (Date.now() >= recheck) {
        // The stream may have missed the start while it attached: read the log back.
        if (await this.biometricPendingInLog(watch.since)) watch.pending = true;
        recheck = Date.now() + BIOMETRIC_RECHECK_MS;
        continue;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!watch.pending) {
      this.logger.warn(`biometrics.${match ? 'match' : 'fail'}(): no Face ID / Touch ID authentication started within ${waitMs} ms (did the app ask?); presenting anyway`);
    }
    watch.pending = false;
    // What came before this answer is used up: later read-backs start here.
    watch.since = Date.now();
    await this.notify('-p', `com.apple.BiometricKit_Sim.pearl.${outcome}`);
    await this.notify('-p', `com.apple.BiometricKit_Sim.fingerTouch.${outcome}`);
  }

  /** What Simulator's Device > Shake posts; UIKit delivers a real shake motion event (iOS 26 has no `_sendMotion*`). */
  async shake(): Promise<void> {
    await this.notify('-p', 'com.apple.UIKit.SimulatorShake');
  }

  async clearKeychain(): Promise<void> {
    await this.simctl(['keychain', this.udid, 'reset']);
  }

  /**
   * A simulated remote push (`simctl push`): `data` sits next to `aps`, as a push server would send it. The
   * app's push library sees it while the app is in front; the system shows it only when the app may show
   * notifications (simctl cannot grant that: the app has to ask).
   */
  async sendNotification(n: NotificationSpec): Promise<void> {
    const payload = { aps: { alert: { title: n.title, ...(n.body !== undefined ? { body: n.body } : {}) }, sound: 'default' }, ...n.data };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quiesco-push-'));
    const file = path.join(dir, 'payload.json');
    try {
      await fs.writeFile(file, JSON.stringify(payload));
      await this.simctl(['push', this.udid, this.bundleId, file]).catch((e: unknown) => {
        // The app has no notification permission on this simulator (never allowed, or denied).
        if (/not authorized/i.test((e as Error).message)) {
          throw new QuiescoError('DEVICE_ERROR', `sendNotification: ${this.bundleId} may not show notifications on ${this.sim?.name ?? this.udid} (iOS: "Source is not authorized")`, {
            action: 'sendNotification',
            platform: 'ios',
            hint: 'let the app request the permission and allow it first (app.device.system.allowPermission()); each simulator, parallel workers included, keeps its own answer',
          });
        }
        throw e;
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  // ---- Phase 6.7 batch C: system UI through the XCUITest runner ----

  private get runner(): SystemRunnerLike {
    this.runnerInstance ??= this.options.systemRunner ?? new IosSystemRunner({ udid: this.udid, exec: this.exec, logger: this.logger, ...(this.options.runnerCacheDir !== undefined ? { cacheDir: this.options.runnerCacheDir } : {}) });
    return this.runnerInstance;
  }

  /** Permission alerts have no identifiers and follow the device language: the buttons get ids by position. */
  readonly permissionDialog = { allow: [PERMISSION_ALLOW], deny: [PERMISSION_DENY] } as const;

  /**
   * SpringBoard's alerts and banners, then the UI of the apps in front that are not React (issues #49–#51):
   * a web authentication session or Safari, and the app's own UIKit views (an inline date picker, the
   * keyboard). The app's React views are in that tree too; tapping them is a real touch all the same.
   */
  /** Start the system UI runner: system UI waits start their clock after it (a cold start takes 7–15 s, issue #64). */
  async prepareSystemUi(): Promise<void> {
    await this.startRunner();
  }

  private startRunner(): Promise<void> {
    this.runnerStarting ??= (async () => this.runner.start?.())().finally(() => {
      this.runnerStarting = null;
    });
    return this.runnerStarting;
  }

  readonly systemUiSettleMs = SYSTEM_UI_SETTLE_MS;

  async systemNodes(): Promise<SystemNode[]> {
    const runner = this.runner;
    const nodes = screenNodes(await runner.screen());
    if (runner.elements === undefined) return nodes;
    for (const bundleId of [...OTHER_APPS, this.bundleId]) {
      const tree = await runner.elements(bundleId);
      if (tree.state === RUNNING_FOREGROUND) nodes.push(...uikitNodes(tree.elements, bundleId));
    }
    return nodes;
  }

  /**
   * SpringBoard's UI (alerts, the Face ID prompt, banners) slides in: read it again. Not a node of an app's
   * element tree: a read of that takes seconds (18 s with a web page in it), the animation is over by then.
   */
  systemNodeReread(node: SystemNode): (() => Promise<SystemNode[]>) | null {
    if (node.app !== undefined) return null;
    return async () => screenNodes(await this.runner.screen());
  }

  async tapSystemNode(node: SystemNode): Promise<void> {
    await this.runner.tap((node.bounds.x1 + node.bounds.x2) / 2, (node.bounds.y1 + node.bounds.y2) / 2);
  }

  /**
   * Tap the field, then type with its app's keyboard (XCUITest typeText: any text, as keys), a character
   * per request: typed at once, a React Native controlled input loses repeated letters ("ann" → "an").
   */
  async typeSystemNode(node: SystemNode, text: string): Promise<void> {
    const runner = this.runner;
    if (runner.typeText === undefined) throw new Error('the iOS system UI runner cannot type');
    await this.tapSystemNode(node);
    // The keyboard belongs to the app showing the field. A web page in front of the app can show up in the
    // app's own element tree too (a remote view): then it is another app's keyboard.
    const apps = [...new Set([node.app ?? 'com.apple.springboard', ...OTHER_APPS, this.bundleId])];
    let target: string | null = null;
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      if (target !== null) {
        await runner.typeText(target, segment);
        continue;
      }
      for (const [i, app] of apps.entries()) {
        try {
          await runner.typeText(app, segment);
          target = app;
          break;
        } catch (e) {
          if (i === apps.length - 1 || !/no keyboard/.test((e as Error).message)) throw e;
        }
      }
    }
  }

  async tapSystemPoint(x: number, y: number): Promise<void> {
    await this.runner.tap(x, y);
  }

  /**
   * `simctl openurl` while the app is in the background (issue #48). SpringBoard asks "Open in “<app>”?"
   * (Cancel, Open, in the device's language): Open, the right-hand button, is tapped through the runner.
   * No confirmation within OPEN_URL_CONFIRM_MS (a link the system opens directly): nothing to answer.
   */
  async openUrlFromOutside(url: string): Promise<void> {
    await this.prepareSystemUi();
    await this.simctl(['openurl', this.udid, url]);
    const deadline = Date.now() + OPEN_URL_CONFIRM_MS;
    for (;;) {
      const alert = (await this.runner.screen()).alerts.find((a) => a.buttons.length === 2);
      const open = alert?.buttons[1];
      if (open !== undefined) {
        const [x = 0, y = 0, w = 0, h = 0] = open.frame;
        await this.runner.tap(x + w / 2, y + h / 2);
        return;
      }
      if (Date.now() >= deadline) return;
      await new Promise((r) => setTimeout(r, NOTIFICATION_POLL_MS));
    }
  }

  /**
   * `app.goBack()` on iOS (issue #4), as a user would: tap the navigation bar's back button when the app
   * shows one, else the edge swipe from the left (interactive pop). Through the XCUITest runner, which sees
   * the app's native navigation bar (the agent cannot: it is not a React element).
   */
  async goBack(): Promise<void> {
    const runner = this.runner;
    if (runner.navigationBar === undefined || runner.edgeSwipeBack === undefined) throw new Error('the iOS system UI runner cannot go back');
    const back = backButton(await runner.navigationBar(this.bundleId));
    if (back !== null) {
      const [x = 0, y = 0, w = 0, h = 0] = back.frame;
      await runner.tap(x + w / 2, y + h / 2);
      return;
    }
    await runner.edgeSwipeBack();
  }

  /**
   * Tap the notification titled `title`: its banner while it is shown, else in Notification Center
   * (swiped down from the top edge). Banners read "<time>, <title>, <body>". Waits up to `timeoutMs` for it,
   * counted once the system UI runner is up (issue #64).
   *
   * A tap counts once the app is in front (issue #68): a banner that slides away by itself under the tap
   * also leaves the screen, but the app stays suspended. Otherwise Quiesco looks again — in Notification
   * Center once the banner is gone — and taps the topmost matching notification: a first tap on a stack of
   * the app's notifications only expands it (issue #65).
   */
  async openNotification(title: string, timeoutMs: number): Promise<void> {
    await this.prepareSystemUi();
    const runner = this.runner;
    const matches = (o: { label: string }) => o.label.split(', ').includes(title) || o.label.includes(title);
    let shown: RunnerScreen['others'] = [];
    // The topmost one: in an expanded stack the newest notification comes first.
    const find = async () => {
      shown = (await runner.screen()).others;
      return shown.filter(matches).sort((a, b) => (a.frame[1] ?? 0) - (b.frame[1] ?? 0))[0];
    };
    const appState = runner.appState?.bind(runner);
    const inFront = async () => appState !== undefined && (await appState(this.bundleId).catch(() => 0)) === RUNNING_FOREGROUND;
    const start = Date.now();
    const deadline = start + timeoutMs;
    let centerOpened = false;
    let taps = 0;
    for (;;) {
      const hit = await find();
      if (hit !== undefined && taps < NOTIFICATION_TAPS && (taps === 0 || Date.now() <= deadline)) {
        // The banner slides in, Notification Center slides down: tap only once two reads a moment apart
        // agree on where it is (a tap during the animation misses; the app then stays in the background,
        // suspended — batch D 2026-11-13).
        await new Promise((r) => setTimeout(r, NOTIFICATION_POLL_MS));
        const again = await find();
        if (again === undefined || JSON.stringify(again.frame) !== JSON.stringify(hit.frame)) continue;
        const before = new Set(shown.map((o) => o.label));
        const matching = shown.filter(matches).length;
        const b = screenNodes({ alerts: [], others: [again] })[0]!.bounds;
        await runner.tap((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2);
        taps++;
        // A stack that expanded shows more matching notifications: look again right away.
        const expanded = async () => (await find(), shown.filter(matches).length > matching);
        // On a locked device, and in Notification Center on iOS 27 (the Cover Sheet), a tap may only slide
        // the notification to the right and show an "Open" button on its left (in the device's language),
        // withdrawn ~3 s later (issue #82): a new, small button, not a notification, left in that row. Not
        // one on the right ("Clear", "Options"), nor another notification. Read from the last `find`.
        const revealed = () => shown.find((o) => !before.has(o.label) && !matches(o) && !o.label.includes(', ') && revealedOpen(o.frame, b));
        if (await this.tapOpened(appState !== undefined, inFront, find, deadline, expanded, revealed, title)) return;
        this.logger.warn(`openNotification: the app did not come to the front after tapping "${title}"; looking again`);
        continue;
      }
      if (taps > 0 && (await inFront())) return;
      if (Date.now() > deadline) {
        const seen = (await runner.screen().catch(() => ({ alerts: [], others: [] }))).others.map((o) => JSON.stringify(o.label)).slice(0, 8);
        if (taps > 0) {
          throw new QuiescoError('DEVICE_ERROR', `openNotification: tapped "${title}" ${taps} time(s), but the app did not come to the front within ${timeoutMs}ms (seen: ${seen.join(', ') || 'nothing'})`);
        }
        throw new QuiescoError('DEVICE_ERROR', `openNotification: no notification "${title}" in a banner or Notification Center within ${timeoutMs}ms (seen: ${seen.join(', ') || 'nothing'}). Can the app show notifications (system.allowPermission())?`);
      }
      // The banner goes away after a few seconds (also after a tap that missed it); then the notification is in Notification Center.
      if (!centerOpened && (taps > 0 || Date.now() > start + Math.min(BANNER_WAIT_MS, timeoutMs / 2))) {
        await runner.openNotificationCenter();
        centerOpened = true;
      }
      await new Promise((r) => setTimeout(r, NOTIFICATION_POLL_MS));
    }
  }

  /**
   * Whether a notification tap opened the app: the app is in front within NOTIFICATION_FRONT_MS
   * (`knowsState`), else (a runner that cannot tell) the notification went away within NOTIFICATION_TAP_CONFIRM_MS.
   * An "Open" button the tap revealed (`revealed`, read after each look) is tapped as soon as two looks
   * agree on where it is, and the wait starts again (issue #82: it is withdrawn ~3 s later).
   */
  private async tapOpened(
    knowsState: boolean,
    inFront: () => Promise<boolean>,
    find: () => Promise<unknown>,
    deadline: number,
    expanded: () => Promise<boolean>,
    revealed: () => RunnerScreen['others'][number] | undefined,
    title: string,
  ): Promise<boolean> {
    // Not past the call's deadline (but one look at least).
    const waitUntil = () => Math.min(Date.now() + (knowsState ? NOTIFICATION_FRONT_MS : NOTIFICATION_TAP_CONFIRM_MS), Math.max(deadline, Date.now()));
    let until = waitUntil();
    let openAt: string | undefined;
    let openTapped = false;
    for (;;) {
      if (knowsState ? await inFront() : (await find()) === undefined) return true;
      if (knowsState && (await expanded())) return false;
      const open = openTapped ? undefined : revealed();
      const at = open === undefined ? undefined : JSON.stringify(open.frame);
      if (open !== undefined && at === openAt) {
        const r = screenNodes({ alerts: [], others: [open] })[0]!.bounds;
        this.logger.warn(`openNotification: tapping "${title}" showed ${JSON.stringify(open.label)} (Notification Center on iOS 27, or a locked device); tapping it`);
        await this.runner.tap((r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2);
        openTapped = true;
        until = waitUntil();
        continue;
      }
      openAt = at;
      if (Date.now() >= until) return false;
      await new Promise((r) => setTimeout(r, NOTIFICATION_POLL_MS));
    }
  }

  /** Alerts outlive the app (a relaunch keeps a permission alert up): dismiss what an earlier scenario left. */
  private async dismissLeftoverAlerts(): Promise<void> {
    if (this.runnerInstance?.running !== true) return;
    for (let i = 0; i < 3; i++) {
      const alert = (await this.runner.screen().catch(() => null))?.alerts[0];
      if (alert === undefined) return;
      const button = dismissButton(alert);
      if (button === undefined) return;
      this.logger.warn(`dismissing a system alert left by the previous scenario: ${JSON.stringify(alert.label)}`);
      const [x = 0, y = 0, w = 0, h = 0] = button.frame;
      await this.runner.tap(x + w / 2, y + h / 2).catch(() => undefined);
    }
  }

  /**
   * A system alert left over by an earlier run or scenario covers the app (Phase 6.12: before the runner
   * was started in this session, nothing removed it). Called when an action finds its element covered or
   * outside any window: starts the runner if needed and dismisses the alerts.
   */
  async dismissSystemAlerts(): Promise<string[]> {
    const closed: string[] = [];
    for (let i = 0; i < 3; i++) {
      const alert = (await this.runner.screen().catch(() => null))?.alerts[0];
      if (alert === undefined) break;
      const button = dismissButton(alert);
      if (button === undefined) break;
      this.logger.warn(`dismissing a system alert covering the app: ${JSON.stringify(alert.label)}`);
      const [x = 0, y = 0, w = 0, h = 0] = button.frame;
      await this.runner.tap(x + w / 2, y + h / 2).catch(() => undefined);
      closed.push(alert.label);
    }
    return closed;
  }

  async resetDeviceState(app: InAppControls): Promise<StateChange> {
    await this.dismissLeftoverAlerts();
    for (const [what, value] of this.changed) {
      switch (what) {
        case 'orientation':
          await app.setOrientation('portrait').catch(() => undefined); // a terminated app starts in portrait anyway
          break;
        case 'location':
          await this.simctl(['location', this.udid, 'clear']).catch(() => undefined);
          break;
        case 'appearance':
          await this.simctl(['ui', this.udid, 'appearance', value]);
          break;
        case 'contentSize':
          await this.simctl(['ui', this.udid, 'content_size', value]);
          break;
        case 'biometrics':
          await this.setEnrollment(value).catch(() => undefined);
          break;
        case 'statusBar':
          await this.simctl(['status_bar', this.udid, 'clear']).catch(() => undefined);
          break;
      }
    }
    this.changed.clear();
    const relaunch = this.locale !== null;
    this.locale = null;
    return { relaunch };
  }

  /** Current `simctl ui` value (light / dark, a content size), or `fallback`. */
  private async current(option: 'appearance' | 'content_size', fallback: string): Promise<string> {
    const v = (await this.simctl(['ui', this.udid, option]).catch(() => '')).trim();
    return v === '' || v === 'unknown' || v === 'unsupported' ? fallback : v;
  }

  /** The simulator shares the Mac's network: host ports are reachable as they are. */
  async reversePort(): Promise<void> {}

  async unreversePort(): Promise<void> {}

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
          hint: 'use app.goBack(): the navigation bar back button, else the edge swipe',
        });
      case 'goBack':
        await this.goBack();
        return;
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

  // ---- Phase 6.9 artifacts ----

  /** `simctl io recordVideo` (H.264 MP4); resolves once it reports that recording started. */
  async startVideo(basePath: string): Promise<void> {
    await this.stopVideo();
    const file = `${basePath}.mp4`;
    const child = (this.options.spawnProcess ?? spawnProcess)('xcrun', ['simctl', 'io', this.udid, 'recordVideo', '--codec=h264', '--force', file]);
    let err = '';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`recordVideo did not start within 10 s: ${err.slice(-300)}`)), 10_000);
      child.stderr?.on('data', (d) => {
        err += d.toString();
        if (/Recording started/i.test(err)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`recordVideo exited (${code}): ${err.slice(-300)}`));
      });
    });
    this.recorder = { child, file };
  }

  /** SIGINT finishes the MP4 (findings 6.9: 10–20 ms). */
  async stopVideo(): Promise<string[]> {
    const r = this.recorder;
    this.recorder = null;
    if (r === null) return [];
    r.child.kill('SIGINT');
    await exited(r.child);
    return [r.file];
  }

  /**
   * The app process's unified log (`log stream`, info level and above), without the accessibility runtime's
   * notifications (most of the volume, findings 6.9).
   */
  async startDeviceLogs(): Promise<void> {
    if (this.logStream !== null) return;
    const exe = await this.executableName();
    const child = (this.options.spawnProcess ?? spawnProcess)('xcrun', ['simctl', 'spawn', this.udid, 'log', 'stream', '--style', 'compact', '--level', 'info', '--predicate', `process == "${exe}" AND NOT subsystem BEGINSWITH "com.apple.Accessibility"`]);
    child.stdout?.on('data', (d) => this.logs.write(d));
    this.logStream = child;
  }

  deviceLogs(since: number): string[] {
    return this.logs.since(since).filter((l) => !/^(Timestamp|Filtering the log data)/.test(l));
  }

  /** CFBundleExecutable of the installed app (the process name in the log). */
  private async executableName(): Promise<string> {
    const info = await this.simctl(['appinfo', this.udid, this.bundleId]).catch(() => '');
    const m = /CFBundleExecutable\s*=\s*"?([^";\n]+)"?;/.exec(info);
    if (m?.[1] !== undefined) return m[1].trim();
    if (this.options.app.binaryPath !== undefined) return path.basename(this.options.app.binaryPath, '.app');
    throw new QuiescoError('DEVICE_ERROR', `cannot tell the executable of ${this.bundleId} (simctl appinfo)`);
  }

  async shutdown(): Promise<void> {
    await this.stopVideo().catch(() => undefined);
    this.logStream?.kill('SIGINT');
    this.logStream = null;
    this.biometricWatch?.child.kill('SIGINT');
    this.biometricWatch = null;
    await this.runnerInstance?.stop().catch(() => undefined);
    if (this.sim === null) return;
    if (this.bootedByUs && this.options.device?.shutdown === true) await this.simctl(['shutdown', this.sim.udid]).catch(() => undefined);
  }

  async isAppRunning(): Promise<boolean> {
    const services = await this.simctl(['spawn', this.udid, 'launchctl', 'list']);
    return services.split('\n').some((l) => l.includes(`UIKitApplication:${this.bundleId}[`) && /^\d+\s/.test(l));
  }

  /**
   * The app's crash report (`.ips`), written by ReportCrash about a second after the crash: waits up to
   * `crashReportWaitMs` for it.
   */
  async crashReport(sinceMs: number): Promise<CrashReport | null> {
    const dir = this.options.crashReportDir ?? path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports');
    const deadline = Date.now() + (this.options.crashReportWaitMs ?? 5_000);
    for (;;) {
      const report = await newestIosCrash(dir, this.bundleId, sinceMs);
      if (report !== null || Date.now() >= deadline) return report;
      await new Promise((r) => setTimeout(r, 250));
    }
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
