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
