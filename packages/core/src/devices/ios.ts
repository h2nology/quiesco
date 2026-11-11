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
 * - Phase 6.5: launch arguments as `-quiescoArgs <base64 JSON>`; a launch URL as `-quiescoUrl`, which
 *   @quiesco/native hands to expo-linking; background = `-[UIApplication suspend]` inside the app (home
 *   screen), or opening the Settings app for apps without @quiesco/native; foreground = `simctl launch`
 *   without terminating (the running process is activated, its arguments are ignored).
 */
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
import { IosSystemRunner, PERMISSION_ALLOW, PERMISSION_DENY, dismissButton, screenNodes } from './ios-runner.js';
import type { Permission } from './permissions.js';
import type { ColorScheme, DeviceProvider, InAppControls, LaunchParams, LaunchUrlHandling, NotificationSpec, StateChange, StatusBarOptions, SystemNode } from './provider.js';

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
}

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
}

/** What IosProvider uses of IosSystemRunner. */
export type SystemRunnerLike = Pick<IosSystemRunner, 'running' | 'screen' | 'tap' | 'openNotificationCenter' | 'stop'>;

/** `27.0` / `iOS 27.0` / `27` → does the runtime identifier match? */
export function runtimeMatches(runtime: string, version: string): boolean {
  const v = version.replace(/^iOS\s*/i, '').trim().replace(/\./g, '-');
  return runtime.endsWith(`.iOS-${v}`) || runtime.includes(`.iOS-${v}-`);
}

/** Choose a simulator: udid, else name (+ os), preferring a booted one; else the only booted one. */
export function chooseSimulator(devices: readonly SimDevice[], cfg: IosDeviceConfig): SimDevice {
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

/** Darwin notification state BiometricKit_Sim reads for "enrolled" (1 / 0). */
const BIOMETRIC_ENROLLMENT = 'com.apple.BiometricKit.enrollmentChanged';

/** openNotification: how long to look for the notification; after BANNER_WAIT_MS, in Notification Center. */
const NOTIFICATION_WAIT_MS = 10_000;
const BANNER_WAIT_MS = 2_000;
const NOTIFICATION_POLL_MS = 250;

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
  /** Phase 6.9 artifacts: the running recorder and log stream. */
  private recorder: { child: ChildLike; file: string } | null = null;
  private logStream: ChildLike | null = null;
  private readonly logs = new LogBuffer();

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
      devices: Record<string, { udid: string; name: string; state: string; dataPath?: string; isAvailable?: boolean }[]>;
    };
    return Object.entries(json.devices).flatMap(([runtime, ds]) =>
      ds.map((d) => ({ udid: d.udid, name: d.name, state: d.state, runtime, ...(d.dataPath !== undefined ? { dataPath: d.dataPath } : {}) })),
    );
  }

  async boot(): Promise<void> {
    const cfg = this.options.device ?? {};
    this.sim = chooseSimulator(await this.devices(), cfg);
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

  async setBiometricEnrollment(enrolled: boolean): Promise<{ leftApp: boolean }> {
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
      await this.simctl(['push', this.udid, this.bundleId, file]);
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

  async systemNodes(): Promise<SystemNode[]> {
    return screenNodes(await this.runner.screen());
  }

  async tapSystemNode(node: SystemNode): Promise<void> {
    await this.runner.tap((node.bounds.x1 + node.bounds.x2) / 2, (node.bounds.y1 + node.bounds.y2) / 2);
  }

  /**
   * Tap the notification titled `title`: its banner while it is shown, else in Notification Center
   * (swiped down from the top edge). Banners read "<time>, <title>, <body>".
   */
  async openNotification(title: string): Promise<void> {
    const find = async () => (await this.runner.screen()).others.find((o) => o.label.split(', ').includes(title) || o.label.includes(title));
    const deadline = Date.now() + NOTIFICATION_WAIT_MS;
    let centerOpened = false;
    for (;;) {
      const hit = await find();
      if (hit !== undefined) {
        const b = screenNodes({ alerts: [], others: [hit] })[0]!.bounds;
        await this.runner.tap((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2);
        return;
      }
      if (Date.now() > deadline) {
        const seen = (await this.runner.screen().catch(() => ({ alerts: [], others: [] }))).others.map((o) => JSON.stringify(o.label)).slice(0, 8);
        throw new QuiescoError('DEVICE_ERROR', `openNotification: no notification "${title}" in a banner or Notification Center (seen: ${seen.join(', ') || 'nothing'}). Can the app show notifications (system.allowPermission())?`);
      }
      // The banner goes away after a few seconds; then the notification is in Notification Center.
      if (!centerOpened && Date.now() > deadline - NOTIFICATION_WAIT_MS + BANNER_WAIT_MS) {
        await this.runner.openNotificationCenter();
        centerOpened = true;
      }
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
    await this.runnerInstance?.stop().catch(() => undefined);
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
