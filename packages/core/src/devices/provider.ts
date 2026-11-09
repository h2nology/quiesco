/** Device abstraction (requirements.md §6.9). One implementation per platform; platform branches live here. */
import type { GestureSlop, HostInput, Platform } from '@quiesco/protocol';

import type { Permission } from './permissions.js';

export interface LaunchParams {
  port: number;
  sessionId: string;
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
  launch(params: LaunchParams): Promise<void>;
  terminate(): Promise<void>;
  grantPermissions(perms: readonly Permission[]): Promise<void>;
  screenshot(): Promise<Buffer>;
  /** Perform input the agent cannot do itself (system back, opening a URL, web real input). */
  injectInput?(input: HostInput): Promise<void>;
  shutdown(): Promise<void>;
  /** Extra lines for the "app did not connect" message (e.g. adb reverse state). */
  diagnose?(params: LaunchParams): Promise<string[]>;
}
