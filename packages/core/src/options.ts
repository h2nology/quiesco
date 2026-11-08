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
