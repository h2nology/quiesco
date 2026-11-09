/** Device abstraction (requirements.md §6.9). One implementation per platform; platform branches live here. */
import type { GestureSlop, HostInput, Platform } from '@quiesco/protocol';

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

/** Ways into the app the provider may use for sendToBackground (iOS: `-[UIApplication suspend]`). */
export interface InAppControls {
  /** Ask @quiesco/native to leave for the home screen; false when the app cannot. */
  suspend(): Promise<boolean>;
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
}
