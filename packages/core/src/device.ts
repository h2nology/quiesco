/**
 * `app.device.*` (Phase 6.5): the app's lifecycle on the device — relaunch with arguments / a deep link /
 * clean data, terminate, background and foreground, install / uninstall, screenshots, port forwarding.
 * Platform differences live in the DeviceProviders; this class only orders the steps and keeps track of
 * whether the app is running, so element calls fail fast instead of waiting for a reconnect.
 */
import type { DeviceInfo, Orientation, Rect } from '@quiesco/protocol';

import type { Permission } from './devices/permissions.js';
import type { ColorScheme, DeviceProvider, InAppControls, LaunchUrlHandling, NotificationSpec, StateChange, StatusBarOptions, SystemNode } from './devices/provider.js';
import { QuiescoError } from './errors.js';
import { checkLaunchArgs } from './launch-args.js';
import type { LaunchArgs } from './launch-args.js';
import type { Logger } from './logger.js';
import type { MatcherInput } from './matcher.js';
import { cropPng, pngSize } from './png.js';
import { SYSTEM_WAIT_MS, checkSystemQuery, describeSystemQuery, matchesSystemQuery, seenTexts } from './system-ui.js';
import type { SystemQuery, SystemWaitOptions } from './system-ui.js';

/** What the test did to the app last. Element calls need `running`. */
export type AppRunState = 'running' | 'background' | 'terminated';

export interface RelaunchOptions {
  /** Launch arguments (any JSON), merged over the config's `launchArgs`; read with `quiesco.launchArgs()`. */
  args?: LaunchArgs;
  /** Open the app with this deep link (e.g. `myapp://todos/1`; on the web its path is opened). */
  url?: string;
  /** Delete the app's data first (native: the app's storage; web: a fresh browser context). */
  clearData?: boolean;
  /** Uninstall and install the app first (needs the app's `binaryPath`; web: like clearData). */
  reinstall?: boolean;
  /** Permissions to grant before the launch, besides the config's. */
  permissions?: Permission[];
}

/** What DeviceApi needs from the session (implemented by Session). */
export interface DeviceHost {
  readonly provider: DeviceProvider;
  readonly logger: Logger;
  /** The config's `permissions`. */
  readonly permissions: readonly Permission[];
  appState: AppRunState;
  /** Launch with the session's connection parameters and wait until the app connected. */
  launch(extra: { args?: LaunchArgs; url?: string }): Promise<{ nativeModule: boolean; urlHandling: LaunchUrlHandling | void }>;
  /** Agent calls that bypass the "app is running" check. */
  deviceInfo(timeoutMs?: number): Promise<DeviceInfo>;
  suspendInApp(): Promise<boolean>;
  setOrientationInApp(orientation: Orientation): Promise<{ supported: boolean; error?: string }>;
  getClipboardInApp(): Promise<{ supported: boolean; text?: string }>;
  setClipboardInApp(text: string): Promise<{ supported: boolean }>;
  postNotificationInApp(n: NotificationSpec): Promise<{ supported: boolean; enabled?: boolean }>;
  /** Simulated offline mode in the agent (Phase 6.6): sent now when running, and with every later hello. */
  setOffline(offline: boolean): Promise<void>;
  /** Re-send the current agent config (after the app was in the background). */
  reapplyConfig(): Promise<void>;
  waitForIdle(): Promise<void>;
  elementRect(target: MatcherInput): Promise<Rect>;
  openUrl(url: string): Promise<void>;
  pressBack(): Promise<void>;
}

/** How long sendToBackground / bringToForeground wait for the app to report its new AppState. */
const STATE_WAIT_MS = 5_000;
const STATE_POLL_MS = 100;

/** How long a device-state change may take to reach the app (it is read back from the app). */
const SETTLE_MS = 8_000;

export class DeviceApi {
  /** Permissions changed this scenario, restored before the next one (HU 2026-11-09). */
  private readonly permissionChanges = new Set<Permission>();
  /** setNetwork('offline') and clipboard.set() this scenario, undone before the next one. */
  private offline = false;
  private clipboardSet = false;

  /**
   * Face ID / Touch ID / fingerprint (Phase 6.7). `enroll(true)` enrolls one (Android: through Settings, with
   * a screen-lock PIN set by Quiesco; the app comes back to the front), `match()` / `fail()` present a
   * matching / unknown one to the authentication the app is showing. After `fail()` the system keeps its
   * retry prompt up, as on a real device. Enrollment is undone before the next scenario.
   */
  readonly biometrics = {
    enroll: async (enrolled = true): Promise<void> => {
      if (typeof enrolled !== 'boolean') throw new TypeError('biometrics.enroll(enrolled) needs a boolean');
      const p = this.host.provider;
      if (p.setBiometricEnrollment === undefined) throw notSupported('biometrics.enroll', p.platform, SYSTEM_HINT.web);
      const { leftApp } = await p.setBiometricEnrollment(enrolled);
      if (leftApp && this.host.appState === 'running') {
        this.host.appState = 'background';
        await this.bringToForeground();
      }
    },
    match: (): Promise<void> => this.biometric(true),
    fail: (): Promise<void> => this.biometric(false),
  };

  /**
   * System UI outside the app (Phase 6.7 batch C): permission dialogs, the biometric prompt. Each call
   * waits for the UI to show up (or go away) within `timeoutMs` (default 10 s). Taps wait for the app to
   * be idle afterwards.
   */
  readonly system = {
    tap: async (query: SystemQuery, opts: SystemWaitOptions = {}): Promise<void> => {
      checkSystemQuery('system.tap', query);
      const node = await this.findSystemNode('system.tap', describeSystemQuery(query), (nodes) => nodes.find((n) => matchesSystemQuery(n, query)), opts);
      await this.systemProvider('system.tap').tapSystemNode(node);
      if (this.host.appState === 'running') await this.host.waitForIdle();
    },
    expectVisible: async (query: SystemQuery, opts: SystemWaitOptions = {}): Promise<void> => {
      checkSystemQuery('system.expectVisible', query);
      await this.findSystemNode('system.expectVisible', describeSystemQuery(query), (nodes) => nodes.find((n) => matchesSystemQuery(n, query)), opts);
    },
    expectNotVisible: async (query: SystemQuery, opts: SystemWaitOptions = {}): Promise<void> => {
      checkSystemQuery('system.expectNotVisible', query);
      const p = this.systemProvider('system.expectNotVisible');
      const deadline = Date.now() + (opts.timeoutMs ?? SYSTEM_WAIT_MS);
      for (;;) {
        const match = (await p.systemNodes()).find((n) => matchesSystemQuery(n, query));
        if (match === undefined) return;
        if (Date.now() >= deadline) {
          throw new QuiescoError('ASSERTION_FAILED', `system.expectNotVisible: ${describeSystemQuery(query)} is still on screen (${JSON.stringify(match.text)})`, {
            expected: 'not visible',
            actual: match.text,
          });
        }
        await new Promise((r) => setTimeout(r, STATE_POLL_MS));
      }
    },
    /** Tap the permission dialog's allow button (whatever the device language); waits until the app is back in front. */
    allowPermission: (opts: SystemWaitOptions = {}): Promise<void> => this.answerPermission(true, opts),
    /** Tap the permission dialog's deny button (also "deny and don't ask again"); waits until the app is back in front. */
    denyPermission: (opts: SystemWaitOptions = {}): Promise<void> => this.answerPermission(false, opts),
  };

  /** The device clipboard (plain text), as the app sees it. Cleared before the next scenario when set. */
  readonly clipboard = {
    set: async (text: string): Promise<void> => {
      if (typeof text !== 'string') throw new TypeError('clipboard.set(text) needs a string');
      const p = this.host.provider;
      if (p.setClipboard === undefined) throw notSupported('clipboard.set', p.platform);
      this.requireRunning('clipboard.set');
      await p.setClipboard(text, this.inApp);
      this.clipboardSet = true;
    },
    get: async (): Promise<string> => {
      const p = this.host.provider;
      if (p.getClipboard === undefined) throw notSupported('clipboard.get', p.platform);
      this.requireRunning('clipboard.get');
      return p.getClipboard(this.inApp);
    },
  };

  constructor(private readonly host: DeviceHost) {}

  private get inApp(): InAppControls {
    return {
      suspend: () => this.host.suspendInApp(),
      // Not while the app is down: a terminated app starts in portrait, and a request would wait for a reconnect.
      setOrientation: async (o) => (this.host.appState === 'running' ? this.host.setOrientationInApp(o) : { supported: false }),
      getClipboard: () => this.host.getClipboardInApp(),
      setClipboard: (text) => this.host.setClipboardInApp(text),
      postNotification: (n) => {
        if (this.host.appState === 'terminated') throw notRunning('sendNotification');
        return this.host.postNotificationInApp(n);
      },
    };
  }

  get platform(): DeviceProvider['platform'] {
    return this.host.provider.platform;
  }

  /** Whether the test left the app running, in the background or terminated. */
  get appState(): AppRunState {
    return this.host.appState;
  }

  /**
   * Terminate and start the app again — always a new process (Detox `newInstance: true`). Data is kept
   * unless `clearData` / `reinstall`. Resolves when the app has connected.
   */
  async relaunch(opts: RelaunchOptions = {}): Promise<void> {
    const args = opts.args === undefined ? undefined : checkLaunchArgs(opts.args, 'relaunch({ args })');
    if (opts.url !== undefined && (typeof opts.url !== 'string' || opts.url === '')) throw new RangeError('relaunch({ url }) must be a non-empty string');
    const p = this.host.provider;
    const wipe = opts.clearData === true || opts.reinstall === true;
    await p.terminate({ keepData: !wipe });
    this.host.appState = 'terminated';
    if (opts.reinstall === true && p.uninstall !== undefined) {
      await p.uninstall();
      await p.install();
    } else if (wipe) {
      // Web: the terminate above already dropped the browser context.
      await p.clearData?.();
    }
    const perms = [...new Set([...this.host.permissions, ...(opts.permissions ?? [])])];
    if (perms.length > 0 && (wipe || opts.permissions !== undefined)) await p.grantPermissions(perms);
    const launched = await this.host.launch({ ...(args !== undefined ? { args } : {}), ...(opts.url !== undefined ? { url: opts.url } : {}) });
    this.host.appState = 'running';
    if (opts.url !== undefined && launched.urlHandling === 'needs-native' && !launched.nativeModule) {
      // HU 2026-11-09: no real cold start with the link here — open it after the launch instead.
      this.host.logger.warn(`relaunch({ url }): without @quiesco/native the app cannot start with ${opts.url}; opening it after the launch (getInitialURL will not return it)`);
      await this.host.openUrl(opts.url);
    }
  }

  /** Stop the app. Element calls fail with APP_NOT_RUNNING until relaunch(). */
  async terminate(): Promise<void> {
    await this.host.provider.terminate({ keepData: true });
    this.host.appState = 'terminated';
  }

  /** Home button (iOS / Android). The process keeps running; element calls fail with APP_IN_BACKGROUND. */
  async sendToBackground(): Promise<void> {
    const p = this.host.provider;
    if (p.sendToBackground === undefined) throw notSupported('sendToBackground', p.platform, BACKGROUND_HINT[p.platform]);
    this.requireRunning('sendToBackground');
    await p.sendToBackground(this.inApp);
    this.host.appState = 'background';
    // Best effort: iOS may suspend the app's JS right away, then there is no answer.
    await this.waitForAppState((s) => s === 'background', false);
  }

  /** Bring the backgrounded app back (same process) and wait until it is active and idle. */
  async bringToForeground(): Promise<void> {
    const p = this.host.provider;
    if (p.bringToForeground === undefined) throw notSupported('bringToForeground', p.platform, BACKGROUND_HINT[p.platform]);
    if (this.host.appState === 'running') return;
    if (this.host.appState === 'terminated') throw notRunning('bringToForeground');
    await p.bringToForeground();
    this.host.appState = 'running';
    await this.waitForAppState((s) => s === 'active', true);
    await this.host.reapplyConfig();
    await this.host.waitForIdle();
  }

  /** Install the app binary (`binaryPath`); a running app is stopped. */
  async install(): Promise<void> {
    await this.host.provider.install();
    if (this.host.provider.platform !== 'web') this.host.appState = 'terminated';
  }

  /** Remove the app from the device. */
  async uninstall(): Promise<void> {
    const p = this.host.provider;
    if (p.uninstall === undefined) throw notSupported('uninstall', p.platform, 'the web has nothing to uninstall: use relaunch({ clearData: true })');
    await p.uninstall();
    this.host.appState = 'terminated';
  }

  /**
   * PNG of the screen, or of one element (cut out of the screen by its rectangle; only the part on the
   * screen). Saving it is up to the caller.
   */
  async screenshot(target?: MatcherInput): Promise<Buffer> {
    if (target === undefined) return this.host.provider.screenshot();
    this.requireRunning('screenshot(element)');
    const rect = await this.host.elementRect(target);
    const info = await this.host.deviceInfo();
    const png = await this.host.provider.screenshot();
    const scale = pngSize(png).width / info.window.width;
    try {
      return cropPng(png, { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale });
    } catch (e) {
      throw new QuiescoError('DEVICE_ERROR', `element screenshot failed: ${(e as Error).message}`);
    }
  }

  /** Make host `port` reachable from the device as localhost:`port` (Android); a no-op where the device shares the host's network. */
  async reversePort(port: number): Promise<void> {
    checkPort(port);
    await this.host.provider.reversePort?.(port);
  }

  async unreversePort(port: number): Promise<void> {
    checkPort(port);
    await this.host.provider.unreversePort?.(port);
  }

  // ---- device state (Phase 6.6); each change is undone before the next scenario ----

  /** Rotate the app. Resolves once the app's window has the new shape and the app is idle. */
  async setOrientation(orientation: Orientation): Promise<void> {
    if (orientation !== 'portrait' && orientation !== 'landscape') throw new RangeError(`orientation must be 'portrait' or 'landscape', got ${String(orientation)}`);
    const p = this.provider('setOrientation');
    this.requireRunning('setOrientation');
    await p.setOrientation(orientation, this.inApp);
    await this.waitForApp(
      (i) => (orientation === 'landscape' ? i.window.width > i.window.height : i.window.height >= i.window.width),
      (i) => `the app's window is still ${i.window.width}×${i.window.height}: does the app lock its orientation? (app.json "orientation": "default")`,
    );
  }

  /** Simulated GPS position. */
  async setLocation(latitude: number, longitude: number): Promise<void> {
    if (!(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) throw new RangeError(`invalid location ${latitude}, ${longitude}`);
    await this.provider('setLocation').setLocation({ latitude, longitude });
  }

  /**
   * Grant or revoke a permission while the app runs. Where the system kills the app on revoke
   * (Android), the app is started again (data kept) before this resolves (HU 2026-11-09).
   */
  async setPermission(permission: Permission, state: 'grant' | 'revoke' | 'reset'): Promise<void> {
    if (state !== 'grant' && state !== 'revoke' && state !== 'reset') throw new RangeError(`state must be 'grant', 'revoke' or 'reset', got ${String(state)}`);
    const change =
      state === 'reset' ? await this.provider('resetPermission').resetPermission(permission) : await this.provider('setPermission').setPermission(permission, state === 'grant');
    this.permissionChanges.add(permission);
    await this.afterChange(change, `setPermission(${permission}, ${state})`);
  }

  /** Light / dark mode. The app must follow the system (app.json "userInterfaceStyle": "automatic"). */
  async setAppearance(scheme: ColorScheme): Promise<void> {
    if (scheme !== 'light' && scheme !== 'dark') throw new RangeError(`scheme must be 'light' or 'dark', got ${String(scheme)}`);
    this.requireRunning('setAppearance');
    await this.provider('setAppearance').setAppearance(scheme);
    await this.waitForApp(
      (i) => i.colorScheme === undefined || i.colorScheme === scheme,
      (i) => `the app still reports colorScheme ${String(i.colorScheme)}: does it force one? (app.json "userInterfaceStyle": "automatic")`,
    );
  }

  /**
   * System text size. iOS uses the nearest Dynamic Type size and applies it live; Android starts the app
   * again (data kept), as it would recreate the activity. Resolves with the scale applied.
   */
  async setFontScale(scale: number): Promise<number> {
    if (!(scale >= 0.5 && scale <= 4)) throw new RangeError(`font scale must be between 0.5 and 4, got ${scale}`);
    this.requireRunning('setFontScale');
    const { scale: applied, ...change } = await this.provider('setFontScale').setFontScale(scale);
    await this.afterChange(change, 'setFontScale');
    await this.waitForApp(
      (i) => i.fontScale === undefined || Math.abs(i.fontScale - applied) < 0.01,
      (i) => `the app still reports font scale ${String(i.fontScale)} (expected ${applied})`,
    );
    return applied;
  }

  /**
   * The app's language and region (BCP 47, e.g. `ja-JP`); `null` for the device default. The app is
   * started again with it (data kept): iOS and the web apply a locale at launch, and Android recreates
   * the activity, which the JS app does not survive cleanly.
   */
  async setLocale(locale: string | null): Promise<void> {
    if (locale !== null && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(locale)) throw new RangeError(`locale must be a BCP 47 tag like 'ja-JP', got ${locale}`);
    const change = await this.provider('setLocale').setLocale(locale);
    await this.afterChange(change, 'setLocale');
    if (locale === null) return;
    const lang = (locale.split('-')[0] as string).toLowerCase();
    await this.waitForApp(
      (i) => i.locale === undefined || i.locale.toLowerCase().split('-')[0] === lang,
      (i) => `the app still uses locale ${String(i.locale)}: does it support ${locale}? (iOS: CFBundleLocalizations in Info.plist, expo.ios.infoPlist)`,
    );
  }

  /** Shake the device (iOS: Simulator's Device > Shake; Android emulator: accelerometer pushes). Waits for idle after. */
  async shake(): Promise<void> {
    const p = this.host.provider;
    if (p.shake === undefined) throw notSupported('shake', p.platform, SYSTEM_HINT.web);
    this.requireRunning('shake');
    await p.shake();
    await this.host.waitForIdle();
  }

  /**
   * Deliver a notification (Phase 6.7). iOS: a simulated remote push (`simctl push`); the app's push
   * library sees it ("received" while the app is in front; shown by the system only when the app may
   * show notifications). Android: posted as the app (an emulator has no push service), without the push
   * library's callbacks. Also while the app is in the background.
   */
  async sendNotification(n: NotificationSpec): Promise<void> {
    if (typeof n !== 'object' || n === null || typeof n.title !== 'string' || n.title === '') throw new TypeError('sendNotification({ title }) needs a non-empty title');
    if (n.body !== undefined && typeof n.body !== 'string') throw new TypeError('sendNotification: body must be a string');
    for (const [k, v] of Object.entries(n.data ?? {})) if (typeof v !== 'string') throw new TypeError(`sendNotification: data.${k} must be a string`);
    const p = this.host.provider;
    if (p.sendNotification === undefined) throw notSupported('sendNotification', p.platform, SYSTEM_HINT.web);
    await p.sendNotification(n, this.inApp);
  }

  /**
   * Tap the notification titled `title` in the system's notification list, like a user opening it from the
   * background; resolves when the app is in front and idle.
   */
  async openNotification(title: string): Promise<void> {
    if (typeof title !== 'string' || title === '') throw new TypeError('openNotification(title) needs a non-empty title');
    const p = this.host.provider;
    if (p.openNotification === undefined) throw notSupported('openNotification', p.platform, NOTIFICATION_HINT[p.platform]);
    if (this.host.appState === 'terminated') throw notRunning('openNotification');
    await p.openNotification(title);
    this.host.appState = 'running';
    await this.waitForAppState((s) => s === 'active', true);
    await this.host.reapplyConfig();
    await this.host.waitForIdle();
  }

  /** Delete keychain items. iOS resets the whole simulator's keychain; Android has none (use relaunch({ clearData: true })). */
  async clearKeychain(): Promise<void> {
    const p = this.host.provider;
    if (p.clearKeychain === undefined) {
      throw notSupported('clearKeychain', p.platform, p.platform === 'android' ? 'Android has no keychain: relaunch({ clearData: true }) deletes the app\'s data, Keystore keys included' : SYSTEM_HINT.web);
    }
    await p.clearKeychain();
  }

  private async biometric(match: boolean): Promise<void> {
    const p = this.host.provider;
    const action = match ? 'biometrics.match' : 'biometrics.fail';
    if (p.presentBiometric === undefined) throw notSupported(action, p.platform, SYSTEM_HINT.web);
    this.requireRunning(action);
    await p.presentBiometric(match);
  }

  /**
   * Override the status bar (clock, battery, signal) for clean screenshots; undone before the next
   * scenario. The web has no status bar: nothing to do there.
   */
  async setStatusBar(opts: StatusBarOptions): Promise<void> {
    checkStatusBar(opts);
    await this.provider('setStatusBar').setStatusBar(opts);
  }

  /** Back to the real status bar. */
  async resetStatusBar(): Promise<void> {
    await this.provider('resetStatusBar').resetStatusBar();
  }

  /**
   * Offline / online (HU 2026-11-09). On every platform the app's new fetch / XMLHttpRequest / WebSocket
   * connections fail while offline (Quiesco's own connection keeps working); Android also turns Wi-Fi and
   * mobile data off and the web reports `navigator.onLine === false`, so NetInfo and `offline` events see
   * it there. The iOS simulator has no network switch: NetInfo keeps reporting the Mac's network. Lasts
   * across relaunches until online or the next scenario.
   */
  async setNetwork(state: 'offline' | 'online'): Promise<void> {
    if (state !== 'offline' && state !== 'online') throw new RangeError(`state must be 'offline' or 'online', got ${String(state)}`);
    const offline = state === 'offline';
    // Online: the device first, so the app's first new request finds a network.
    if (offline) await this.host.setOffline(true);
    await this.host.provider.setNetwork?.(offline);
    if (!offline) await this.host.setOffline(false);
    this.offline = offline;
  }

  /**
   * Undo this scenario's device-state changes (called by the session before each scenario, and at the
   * end without starting the app again).
   */
  async resetDeviceState(configured: readonly Permission[], opts: { relaunch?: boolean } = {}): Promise<void> {
    const p = this.host.provider;
    let relaunch = false;
    for (const perm of this.permissionChanges) {
      const change = await p.setPermission?.(perm, configured.includes(perm)).catch(() => undefined);
      relaunch ||= change?.relaunch === true;
    }
    this.permissionChanges.clear();
    if (this.clipboardSet) {
      this.clipboardSet = false;
      if (this.host.appState === 'running') await p.setClipboard?.('', this.inApp).catch(() => undefined);
    }
    if (p.resetDeviceState !== undefined) {
      const change = await p.resetDeviceState(this.inApp);
      relaunch ||= change.relaunch;
    }
    if (this.offline) {
      // The provider brought the device's network back above.
      this.offline = false;
      await this.host.setOffline(false).catch(() => undefined);
    }
    if (relaunch && opts.relaunch !== false && this.host.appState !== 'terminated') await this.relaunch();
  }

  private provider<K extends 'setOrientation' | 'setLocation' | 'setPermission' | 'resetPermission' | 'setAppearance' | 'setFontScale' | 'setLocale' | 'setStatusBar' | 'resetStatusBar'>(method: K): Required<Pick<DeviceProvider, K>> {
    const p = this.host.provider;
    if (p[method] === undefined) throw notSupported(method, p.platform, STATE_HINT[method]?.[p.platform]);
    return p as unknown as Required<Pick<DeviceProvider, K>>;
  }

  /** The app must be started again (or the system killed it): relaunch keeping data. */
  private async afterChange(change: StateChange, what: string): Promise<void> {
    if (change.reinstall === true) {
      this.host.logger.warn(`${what}: only reinstalling the app resets it here; reinstalling (the app's data is deleted)`);
      await this.relaunch({ reinstall: true });
      return;
    }
    if (!change.relaunch || this.host.appState === 'terminated') return;
    this.host.logger.info(`${what}: starting the app again`);
    await this.relaunch();
  }

  /** Wait until the app reports `ok`, then for idle; fail with `why` after SETTLE_MS. */
  private async waitForApp(ok: (i: DeviceInfo) => boolean, why: (i: DeviceInfo) => string): Promise<void> {
    const deadline = Date.now() + SETTLE_MS;
    let last: DeviceInfo | null = null;
    for (;;) {
      last = await this.host.deviceInfo(Math.max(1000, deadline - Date.now())).catch(() => last);
      if (last !== null && ok(last)) break;
      if (Date.now() >= deadline) throw new QuiescoError('DEVICE_ERROR', last === null ? 'the app did not answer' : why(last));
      await new Promise((r) => setTimeout(r, STATE_POLL_MS));
    }
    await this.host.waitForIdle();
  }

  /** Same as `app.openUrl(url)`. */
  openUrl(url: string): Promise<void> {
    return this.host.openUrl(url);
  }

  /** Same as `app.pressBack()` (Android system back, web history back). */
  pressBack(): Promise<void> {
    return this.host.pressBack();
  }

  private requireRunning(what: string): void {
    if (this.host.appState === 'terminated') throw notRunning(what);
    if (this.host.appState === 'background') {
      throw new QuiescoError('APP_IN_BACKGROUND', `${what}: the app is in the background; call app.device.bringToForeground() first`, { action: what });
    }
  }

  private systemProvider(action: string): Required<Pick<DeviceProvider, 'systemNodes' | 'tapSystemNode'>> {
    const p = this.host.provider;
    if (p.systemNodes === undefined || p.tapSystemNode === undefined) throw notSupported(action, p.platform, SYSTEM_UI_HINT[p.platform]);
    return { systemNodes: () => p.systemNodes!(), tapSystemNode: (n) => p.tapSystemNode!(n) };
  }

  /** Poll the system UI until a node matches (each listing may take a while: uiautomator dumps take ~2 s). */
  private async findSystemNode(action: string, what: string, pick: (nodes: SystemNode[]) => SystemNode | undefined, opts: SystemWaitOptions): Promise<SystemNode> {
    const p = this.systemProvider(action);
    const timeoutMs = opts.timeoutMs ?? SYSTEM_WAIT_MS;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const nodes = await p.systemNodes();
      const node = pick(nodes);
      if (node !== undefined) return node;
      if (Date.now() >= deadline) {
        const seen = seenTexts(nodes);
        throw new QuiescoError('ELEMENT_NOT_FOUND', `${action}: no system UI matching ${what} within ${timeoutMs}ms (on screen outside the app: ${seen.map((t) => JSON.stringify(t)).join(', ') || 'nothing'})`, {
          action,
          seen,
        });
      }
      await new Promise((r) => setTimeout(r, STATE_POLL_MS));
    }
  }

  private async answerPermission(allow: boolean, opts: SystemWaitOptions): Promise<void> {
    const action = allow ? 'system.allowPermission' : 'system.denyPermission';
    const p = this.host.provider;
    const ids = (allow ? p.permissionDialog?.allow : p.permissionDialog?.deny) ?? [];
    if (ids.length === 0) throw notSupported(action, p.platform, SYSTEM_UI_HINT[p.platform]);
    const rank = (n: SystemNode) => ids.indexOf(n.id);
    // Several may be on screen (location: "while using the app" and "only this time"): the preferred one.
    const node = await this.findSystemNode(action, `the permission dialog's ${allow ? 'allow' : 'deny'} button (${ids.join(' / ')})`, (nodes) => nodes.filter((n) => rank(n) >= 0).sort((a, b) => rank(a) - rank(b))[0], opts);
    await this.systemProvider(action).tapSystemNode(node);
    if (this.host.appState !== 'running') return;
    await this.waitForAppState((s) => s === 'active', true);
    await this.host.waitForIdle();
  }

  private async waitForAppState(ok: (s: DeviceInfo['appState']) => boolean, required: boolean): Promise<void> {
    const deadline = Date.now() + STATE_WAIT_MS;
    let last: string = 'no answer';
    while (Date.now() < deadline) {
      const info = await this.host.deviceInfo(Math.max(500, deadline - Date.now())).catch((e: unknown) => {
        last = (e as Error).message;
        return null;
      });
      if (info !== null) {
        last = info.appState;
        if (ok(info.appState) || info.appState === 'unknown') return;
      }
      await new Promise((r) => setTimeout(r, STATE_POLL_MS));
    }
    if (required) throw new QuiescoError('DEVICE_ERROR', `the app did not become active within ${STATE_WAIT_MS}ms (AppState: ${last})`);
  }
}

const SYSTEM_HINT = { web: 'browsers have no such device feature; tag the scenario @native' } as const;

const NOTIFICATION_HINT: Record<DeviceProvider['platform'], string> = {
  ios: '',
  android: '',
  web: SYSTEM_HINT.web,
};

const SYSTEM_UI_HINT: Record<DeviceProvider['platform'], string> = {
  ios: '',
  android: '',
  web: "a browser's permission prompts are not part of the page: set them with app.device.setPermission",
};

const STATE_HINT: Partial<Record<string, Partial<Record<DeviceProvider['platform'], string>>>> = {
  setFontScale: { web: 'browsers have no system text size' },
};

const BACKGROUND_HINT: Record<DeviceProvider['platform'], string> = {
  ios: '',
  android: '',
  web: 'a browser page driven by Playwright stays visible (no real background state, findings 6.5); tag the scenario @ios / @android',
};

function notSupported(action: string, platform: string, hint?: string): QuiescoError {
  return new QuiescoError('ACTION_NOT_SUPPORTED', `${action} is not supported on ${platform}${hint !== undefined && hint !== '' ? `: ${hint}` : ''}`, {
    action,
    platform,
    ...(hint !== undefined && hint !== '' ? { hint } : {}),
  });
}

function notRunning(what: string): QuiescoError {
  return new QuiescoError('APP_NOT_RUNNING', `${what}: the app is not running (terminated or uninstalled by the test); call app.device.relaunch() first`, { action: what });
}

function checkStatusBar(o: StatusBarOptions): void {
  if (typeof o !== 'object' || o === null) throw new TypeError('setStatusBar(options) needs an object');
  const known = ['time', 'batteryLevel', 'charging', 'wifiBars', 'cellularBars', 'dataNetwork'];
  const unknown = Object.keys(o).filter((k) => !known.includes(k));
  if (unknown.length > 0) throw new RangeError(`setStatusBar: unknown option ${unknown.join(', ')} (${known.join(', ')})`);
  if (Object.keys(o).length === 0) throw new RangeError('setStatusBar needs at least one option');
  if (o.time !== undefined && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(o.time)) throw new RangeError(`setStatusBar: time must be H:MM or HH:MM, got ${o.time}`);
  const int = (v: number | undefined, max: number, name: string): void => {
    if (v !== undefined && !(Number.isInteger(v) && v >= 0 && v <= max)) throw new RangeError(`setStatusBar: ${name} must be an integer 0-${max}, got ${v}`);
  };
  int(o.batteryLevel, 100, 'batteryLevel');
  int(o.wifiBars, 3, 'wifiBars');
  int(o.cellularBars, 4, 'cellularBars');
  if (o.charging !== undefined && typeof o.charging !== 'boolean') throw new RangeError('setStatusBar: charging must be a boolean');
  if (o.dataNetwork !== undefined && !['wifi', '3g', '4g', 'lte', '5g', 'hide'].includes(o.dataNetwork)) {
    throw new RangeError(`setStatusBar: dataNetwork must be wifi, 3g, 4g, lte, 5g or hide, got ${String(o.dataNetwork)}`);
  }
}

function checkPort(port: number): void {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new RangeError(`port must be an integer 1-65535, got ${port}`);
}
