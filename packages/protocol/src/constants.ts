/** Bumped on any incompatible protocol change. The host rejects agents with a different major version. */
export const PROTOCOL_VERSION = 1;

/**
 * Keys used to pass connection parameters to the app at launch (docs/spikes/05-connection-params.md).
 * - iOS: process arguments `-quiescoPort <port> -quiescoSession <id>` (read via UserDefaults)
 * - Android: intent extras `--es quiescoPort <port> --es quiescoSession <id>`
 * - Web: `window.__QUIESCO__ = { port, session }` injected with Playwright's addInitScript
 */
export const LAUNCH_PARAM_PORT = 'quiescoPort';
export const LAUNCH_PARAM_SESSION = 'quiescoSession';
/**
 * Test launch arguments (Phase 6.5): one parameter holding base64 of the JSON object, so values keep
 * their types and no device shell quoting is involved. The JSON is ASCII-only (non-ASCII characters
 * escaped as \uXXXX), so plain `atob` decodes it. Web: `window.__QUIESCO__.args` holds the object itself.
 */
export const LAUNCH_PARAM_ARGS = 'quiescoArgs';
/** iOS: the URL the app is opened with at launch, handed to expo-linking by @quiesco/native. */
export const LAUNCH_PARAM_URL = 'quiescoUrl';
export const WEB_PARAMS_GLOBAL = '__QUIESCO__';

/** Used when no launch parameters are available (JS-only mode, single device). */
export const DEFAULT_PORT = 7357;

/** WebSocket close codes (4000-4999 are reserved for applications by RFC 6455). */
export const CloseCode = {
  /** Normal shutdown by the host. */
  NORMAL: 1000,
  /** The agent's session id does not match any session the host is waiting for. */
  SESSION_MISMATCH: 4001,
  /** Incompatible protocol version. */
  PROTOCOL_MISMATCH: 4002,
  /** A newer connection for the same session replaced this one (e.g. web full-page reload). */
  REPLACED: 4003,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];

/** Defaults from requirements.md §6.2 / §6.13. */
export const SyncDefaults = {
  timeoutMs: 10_000,
  timerThresholdMs: 1_500,
  stableFrames: 2,
  countIntervals: false,
  /** Interval between re-checks while an assertion fails or an action target is not ready yet. */
  retryIntervalMs: 50,
} as const;
