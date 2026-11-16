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
  | 'APP_IN_BACKGROUND'
  /** A web page is blocked on a JS dialog (alert / confirm / prompt); answer it with app.device.system.tap first. */
  | 'DIALOG_OPEN';

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

/** This package's own source / build directory (frames from here are plumbing to a test author). */
const OWN_DIR = new URL('.', import.meta.url).href;
const OWN_PATH = decodeURIComponent(new URL('.', import.meta.url).pathname);

/** A stack frame that tells a test author nothing: Quiesco's own code, the `ws` library, Node internals. */
function isInternalFrame(frame: string): boolean {
  return frame.includes(OWN_DIR) || frame.includes(OWN_PATH) || /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?ws[\\/]/.test(frame) || /\((?:node:|internal\/)|at (?:node:|internal\/)/.test(frame);
}

/**
 * The stack of the caller, taken where a driver call starts (issue #32). Errors that arrive later (an RPC
 * error response, a timeout, an app error) are created on a WebSocket / timer callback, whose stack
 * has only the transport's frames; {@link withCallSite} gives them this one instead.
 */
export function captureCallSite(): Error {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  try {
    return new Error('call site');
  } finally {
    Error.stackTraceLimit = limit;
  }
}

/**
 * Point `error`'s stack at the code that made the call: the frames of `site` without Quiesco's own,
 * `ws`'s and Node's. Keeps the error's stack when nothing would be left (e.g. a call made by Quiesco itself).
 */
export function withCallSite<E extends Error>(error: E, site: Error): E {
  const frames = (site.stack ?? '').split('\n').filter((l) => /^\s+at /.test(l) && !isInternalFrame(l));
  if (frames.length === 0) return error;
  Object.defineProperty(error, 'stack', { value: `${error.name}: ${error.message}\n${frames.join('\n')}`, writable: true, configurable: true });
  return error;
}
