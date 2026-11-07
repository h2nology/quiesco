import type { ActionType } from './actions.js';
import type { ElementSummary } from './element.js';
import type { JsonValue } from './json.js';
import type { Matcher } from './matcher.js';
import type { TrackerState } from './methods.js';

/** Standard JSON-RPC 2.0 error codes. */
export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** Quiesco error codes (requirements.md §7). */
export const ErrorCode = {
  ELEMENT_NOT_FOUND: 1001,
  MULTIPLE_MATCHES: 1002,
  SYNC_TIMEOUT: 1003,
  ASSERTION_FAILED: 1004,
  ACTION_NOT_SUPPORTED: 1005,
  BACKDOOR_NOT_REGISTERED: 1006,
  NOT_SERIALIZABLE: 1007,
  BACKDOOR_FAILED: 1008,
  PROTOCOL_MISMATCH: 1009,
  SESSION_MISMATCH: 1010,
  AGENT_NOT_READY: 1011,
  APP_ERROR: 1012,
  RESET_FAILED: 1013,
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
export type ErrorName = keyof typeof ErrorCode;

/** Structured `error.data` for each Quiesco error code. */
export interface ErrorDataMap {
  ELEMENT_NOT_FOUND: { matcher: Matcher };
  MULTIPLE_MATCHES: { matcher: Matcher; matches: ElementSummary[] };
  SYNC_TIMEOUT: { timeoutMs: number; busy: TrackerState[] };
  ASSERTION_FAILED: { expected: JsonValue; actual: JsonValue; elements: ElementSummary[] };
  ACTION_NOT_SUPPORTED: { action: ActionType; platform: string; hint?: string };
  BACKDOOR_NOT_REGISTERED: { name: string; registered: string[] };
  NOT_SERIALIZABLE: { where: 'args' | 'result'; path: string };
  BACKDOOR_FAILED: { name: string; message: string; stack?: string };
  PROTOCOL_MISMATCH: { host: number; agent: number };
  SESSION_MISMATCH: { expected: string[]; received: string | null };
  AGENT_NOT_READY: { reason: string };
  APP_ERROR: { message: string; stack?: string };
  RESET_FAILED: { step: string; message: string };
}

export interface QuiescoErrorObject<N extends ErrorName = ErrorName> {
  code: (typeof ErrorCode)[N];
  message: string;
  data: { name: N } & ErrorDataMap[N];
}
