import type { ErrorName, JsonRpcErrorObject, JsonValue } from '@quiesco/protocol';

/** Errors raised only on the host side. */
export type HostErrorName =
  | 'CONNECT_TIMEOUT'
  | 'AGENT_TIMEOUT'
  | 'AGENT_DISCONNECTED'
  | 'DEVICE_ERROR'
  | 'CONFIG_ERROR'
  | 'AGENT_ERROR'
  /** The app was terminated / uninstalled by the test (`app.device.*`); relaunch it first. */
  | 'APP_NOT_RUNNING'
  /** The app was sent to the background by the test; bring it to the foreground first. */
  | 'APP_IN_BACKGROUND';

/**
 * Every failure surfaced by @quiesco/core. Agent errors keep their protocol code and structured data
 * (requirements.md §7), so runners can show "expected / actual / elements" etc.
 */
export class QuiescoError extends Error {
  readonly errorName: ErrorName | HostErrorName;
  readonly code: number | undefined;
  readonly data: Record<string, unknown>;

  constructor(name: ErrorName | HostErrorName, message: string, data: Record<string, unknown> = {}, code?: number) {
    super(message);
    this.name = 'QuiescoError';
    this.errorName = name;
    this.data = data;
    this.code = code;
  }

  /** Convert a JSON-RPC error object from the agent. */
  static fromRpc(error: JsonRpcErrorObject | { code: number; message: string; data?: unknown }): QuiescoError {
    const data = (typeof error.data === 'object' && error.data !== null ? error.data : {}) as Record<string, JsonValue>;
    const name = typeof data['name'] === 'string' ? (data['name'] as ErrorName) : 'AGENT_ERROR';
    return new QuiescoError(name, error.message, data, error.code);
  }
}
