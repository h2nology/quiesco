/**
 * `app.device.*` (Phase 6.5): the app's lifecycle on the device — relaunch with arguments / a deep link /
 * clean data, terminate, background and foreground, install / uninstall, screenshots, port forwarding.
 * Platform differences live in the DeviceProviders; this class only orders the steps and keeps track of
 * whether the app is running, so element calls fail fast instead of waiting for a reconnect.
 */
import type { DeviceInfo, Rect } from '@quiesco/protocol';

import type { Permission } from './devices/permissions.js';
import type { DeviceProvider, LaunchUrlHandling } from './devices/provider.js';
import { QuiescoError } from './errors.js';
import { checkLaunchArgs } from './launch-args.js';
import type { LaunchArgs } from './launch-args.js';
import type { Logger } from './logger.js';
import type { MatcherInput } from './matcher.js';
import { cropPng, pngSize } from './png.js';

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

export class DeviceApi {
  constructor(private readonly host: DeviceHost) {}

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
    await p.sendToBackground({ suspend: () => this.host.suspendInApp() });
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

function checkPort(port: number): void {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new RangeError(`port must be an integer 1-65535, got ${port}`);
}
