import type { ActionMode, ActionSpec, HostInput } from './actions.js';
import type { AssertionSpec } from './assertions.js';
import type { AgentConfig } from './config.js';
import type { ElementSummary, TreeNode } from './element.js';
import type { JsonValue } from './json.js';
import type { Matcher } from './matcher.js';

export type Platform = 'ios' | 'android' | 'web';

/** State of one idle tracker (requirements.md §6.2 `IdleTracker`). */
export interface TrackerState {
  name: string;
  idle: boolean;
  /** Human-readable busy reasons, e.g. `GET https://api.example.com/todos (1200ms)`. */
  busy: string[];
}

/** Common option: disable the automatic wait-for-idle around a single call (§6.2 `{ sync: false }`). */
export interface SyncOption {
  sync?: boolean;
  timeoutMs?: number;
}

/** Methods the HOST calls on the AGENT. */
export interface AgentMethods {
  query: { params: { matcher: Matcher } & SyncOption; result: { elements: ElementSummary[] } };
  action: {
    params: { action: ActionSpec; mode: ActionMode } & SyncOption;
    /** `hostInput` is set when the host must perform the real input itself (web native mode). */
    result: { element?: ElementSummary; hostInput?: HostInput };
  };
  assert: { params: { assertion: AssertionSpec } & SyncOption; result: { elements: ElementSummary[] } };
  waitForIdle: { params: { timeoutMs?: number }; result: { waitedMs: number } };
  getTree: { params: Record<string, never>; result: { root: TreeNode | null } };
  reset: { params: Record<string, never>; result: { durationMs: number } };
  backdoor: { params: { name: string; args: JsonValue[] }; result: { value: JsonValue } };
  getIdleState: { params: Record<string, never>; result: { trackers: TrackerState[] } };
  /** Replace the agent config at runtime (Phase 6.5 `app.sync.*`); the next `hello` carries it too. */
  configure: { params: { config: AgentConfig }; result: Record<string, never> };
  /** Window size, pixel ratio and app state (element screenshots, background detection). */
  deviceInfo: { params: Record<string, never>; result: DeviceInfo };
  /** Leave for the home screen from inside the app (iOS @quiesco/native); `false` when not available. */
  suspend: { params: Record<string, never>; result: { suspended: boolean } };
  /**
   * Rotate the app's window from inside the app (iOS @quiesco/native; Phase 6.6). `supported: false`
   * when the app cannot (no native module, other platforms); `error` when iOS refused the request.
   */
  setOrientation: { params: { orientation: Orientation }; result: { supported: boolean; error?: string } };
  /**
   * The clipboard, read / written from inside the app (@quiesco/native; Phase 6.6). Inside the app because
   * iOS asks the user before an app reads text another process (simctl pbcopy) put there, and Android
   * has no shell command for it. `supported: false` without the native module.
   */
  getClipboard: { params: Record<string, never>; result: { supported: boolean; text?: string } };
  setClipboard: { params: { text: string }; result: { supported: boolean } };
  /**
   * Post a notification as the app (Android @quiesco/native; Phase 6.7). `supported: false` without it;
   * `enabled: false` when the app may not show notifications (POST_NOTIFICATIONS not granted).
   */
  postNotification: { params: { title: string; body: string; data: Record<string, string> }; result: { supported: boolean; enabled?: boolean } };
}

export type Orientation = 'portrait' | 'landscape';

/** `AppState` as React Native reports it; `unknown` where it cannot be read. */
export type AppStateName = 'active' | 'background' | 'inactive' | 'unknown';

export interface DeviceInfo {
  /** The app window in logical units (dp / pt / CSS px), the space of element rects. */
  window: { width: number; height: number };
  /** Physical pixels per logical unit. */
  pixelRatio: number;
  appState: AppStateName;
  /** Phase 6.6 read-backs (optional for older agents): what the app sees of the device state. */
  colorScheme?: 'light' | 'dark' | null;
  /** Text size multiplier (`PixelRatio.getFontScale()`). */
  fontScale?: number;
  /** The JS engine's default locale (`Intl.DateTimeFormat().resolvedOptions().locale`). */
  locale?: string;
}

/** Methods the AGENT calls on the HOST. */
export interface HostMethods {
  hello: {
    params: {
      sessionId: string | null;
      platform: Platform;
      protocolVersion: number;
      agentVersion: string;
      /** Whether @quiesco/native is linked (enables the `native` action mode). */
      nativeModule: boolean;
    };
    result: { accepted: true; sessionId: string; config: AgentConfig };
  };
}

export type AgentMethodName = keyof AgentMethods;
export type HostMethodName = keyof HostMethods;
export type ParamsOf<M extends { params: unknown }> = M['params'];
export type ResultOf<M extends { result: unknown }> = M['result'];
