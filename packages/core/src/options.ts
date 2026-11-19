import type { ActionMode } from '@quiesco/protocol';

/** Options every Driver call accepts. */
export interface CallOptions {
  /** Per-call timeout (agent side). Default: `sync.timeoutMs`. */
  timeoutMs?: number;
  /** `false` skips waiting for idle around this call (infinite animations etc.). */
  sync?: boolean;
}

export interface ActionOptions extends CallOptions {
  mode?: ActionMode;
}

/** `type()` options (issue #52). */
export interface TypeOptions extends ActionOptions {
  /**
   * Type one character at a time, as a user does, so the app sees every keystroke (debounced search,
   * input masks, `onKeyPress`). Default: the whole text at once.
   */
  perCharacter?: boolean;
  /** With `perCharacter`: time between two characters (default 80 ms). The call waits for idle at the end. */
  intervalMs?: number;
}
