/** Device abstraction (requirements.md §6.9). One implementation per platform; platform branches live here. */
import type { GestureSlop, HostInput, Orientation, Platform } from '@quiesco/protocol';

import type { Permission } from './permissions.js';

export interface LaunchParams {
  port: number;
  sessionId: string;
  /** Base64 of the launch arguments' JSON (launch-args.ts); omitted when there are none. */
  args?: string;
  /** The same arguments as an object (the web injects the object itself). */
  argsObject?: Record<string, unknown>;
  /** Open the app with this deep link (Phase 6.5 `relaunch({ url })`). */
  url?: string;
}

/**
 * How `launch()` handled `params.url`:
 * - `delivered`: the app starts with it (Android intent data, web path);
 * - `needs-native`: delivered by @quiesco/native in the app (iOS); without it the session falls back to
 *   opening the link after the app connected (HU 2026-11-09).
 */
export type LaunchUrlHandling = 'delivered' | 'needs-native';

/** Ways into the app a provider may use (iOS: `-[UIApplication suspend]`, window rotation). */
export interface InAppControls {
  /** Ask @quiesco/native to leave for the home screen; false when the app cannot. */
  suspend(): Promise<boolean>;
  /** Ask @quiesco/native to rotate the window (Phase 6.6). */
  setOrientation(orientation: Orientation): Promise<{ supported: boolean; error?: string }>;
  /** The clipboard through @quiesco/native (Phase 6.6); `supported: false` without it. */
  getClipboard(): Promise<{ supported: boolean; text?: string }>;
  setClipboard(text: string): Promise<{ supported: boolean }>;
}

/** Status bar overrides for clean screenshots (Phase 6.6); unset fields keep the real value. */
export interface StatusBarOptions {
  /** The clock, `H:MM` / `HH:MM` (e.g. `9:41`). */
  time?: string;
  /** 0–100. */
  batteryLevel?: number;
  charging?: boolean;
  /** Wi-Fi signal, 0–3 bars. */
  wifiBars?: number;
  /** Cellular signal, 0–4 bars. */
  cellularBars?: number;
  /** The data network shown next to the bars; `hide` hides the cellular indicator. */
  dataNetwork?: 'wifi' | '3g' | '4g' | 'lte' | '5g' | 'hide';
}

export type ColorScheme = 'light' | 'dark';

/** How a device-state change reached the app (Phase 6.6). */
export interface StateChange {
  /** The app must be started again to see it (iOS / web locale), or the system killed it (Android revoke). */
  relaunch: boolean;
}

export interface DeviceProvider {
  readonly platform: Platform;
  /** How far the platform's standard pinch / rotation recognizers wait before activating (Phase 6.4). */
  readonly gestureSlop?: GestureSlop;
  /** Start the emulator / simulator / browser (or attach to a running one). */
  boot(): Promise<void>;
  /** Install the app; web: start the static server or check the URL. */
  install(): Promise<void>;
  /** Start the app with the connection parameters. */
  launch(params: LaunchParams): Promise<LaunchUrlHandling | void>;
  /**
   * Stop the app. `keepData` (Phase 6.5 relaunch): the web keeps cookies / storage for the next launch;
   * by default a web launch starts from a clean browser context (hard reset). Native apps keep their data
   * either way (clearData() removes it).
   */
  terminate(opts?: { keepData?: boolean }): Promise<void>;
  grantPermissions(perms: readonly Permission[]): Promise<void>;
  screenshot(): Promise<Buffer>;
  /** Perform input the agent cannot do itself (system back, opening a URL, web real input). */
  injectInput?(input: HostInput): Promise<void>;
  shutdown(): Promise<void>;
  /** Extra lines for the "app did not connect" message (e.g. adb reverse state). */
  diagnose?(params: LaunchParams): Promise<string[]>;

  // ---- Phase 6.5 lifecycle; a missing method means ACTION_NOT_SUPPORTED on that platform ----

  /** Delete the app's data (the app is terminated). Android also loses granted runtime permissions. */
  clearData?(): Promise<void>;
  /** Remove the app from the device (the app is terminated). */
  uninstall?(): Promise<void>;
  /** Put the app in the background, the process keeps running. */
  sendToBackground?(app: InAppControls): Promise<void>;
  /** Bring the backgrounded app back without restarting it. */
  bringToForeground?(): Promise<void>;
  /** Make a host port reachable from the device under the same port (Android `adb reverse`). */
  reversePort?(port: number): Promise<void>;
  unreversePort?(port: number): Promise<void>;

  // ---- Phase 6.6 device state; a missing method means ACTION_NOT_SUPPORTED on that platform ----

  setOrientation?(orientation: Orientation, app: InAppControls): Promise<void>;
  setLocation?(location: { latitude: number; longitude: number }): Promise<void>;
  /** Grant or revoke one permission while the app runs. */
  setPermission?(permission: Permission, grant: boolean): Promise<StateChange>;
  setAppearance?(scheme: ColorScheme): Promise<void>;
  /** Text size; `scale` = what the platform actually applies (iOS: the nearest Dynamic Type size). */
  setFontScale?(scale: number): Promise<StateChange & { scale: number }>;
  /** BCP 47 locale, e.g. `ja-JP`; `null` = the device default. */
  setLocale?(locale: string | null): Promise<StateChange>;
  /** Override the status bar (validated by the caller); a no-op where there is none (web). */
  setStatusBar?(opts: StatusBarOptions): Promise<void>;
  resetStatusBar?(): Promise<void>;
  /**
   * Cut / restore the device's own network where the platform can (Android `svc`, the web's network
   * emulation). The agent blocks the app's connections in any case (HU 2026-11-09).
   */
  setNetwork?(offline: boolean): Promise<void>;
  getClipboard?(app: InAppControls): Promise<string>;
  setClipboard?(text: string, app: InAppControls): Promise<void>;

  // ---- Phase 6.7 system integration; a missing method means ACTION_NOT_SUPPORTED on that platform ----

  /**
   * Enroll / remove a face or fingerprint. `leftApp`: the platform had to open another app (Android
   * Settings) and the app under test is now in the background.
   */
  setBiometricEnrollment?(enrolled: boolean): Promise<{ leftApp: boolean }>;
  /** Present an enrolled (match) or unknown (no match) face / finger to a pending authentication. */
  presentBiometric?(match: boolean): Promise<void>;
  /** A device shake as the platform delivers it. */
  shake?(): Promise<void>;
  /** Delete the keychain items (iOS: the whole simulator's keychain). */
  clearKeychain?(): Promise<void>;
  /**
   * Undo every device-state change made since the last call (before each scenario, HU 2026-11-09).
   * Permissions are restored by the caller (it knows the configured ones).
   */
  resetDeviceState?(app: InAppControls): Promise<StateChange>;
}
