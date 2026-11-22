/** One step of a multi-step action (issue #78). */
export interface StepTiming {
  /** ms from the start of the call to the start of the step (agent clock). */
  atMs: number;
  /** How long the step took (drag and wait for idle). */
  ms: number;
  /** Of which waiting for idle. */
  syncMs: number;
  /** What the step did, e.g. `down`. */
  label: string;
}

/**
 * How a wait for idle ended (issue #107): when, its last checks and what the trackers saw going on during
 * it. A failure where the app was between two pieces of work then shows which gap passed as idle.
 */
export interface WaitEnd {
  /** ms since the epoch (the device's clock), to line up with the device log. */
  endedAt: number;
  /** The last checks, oldest first: `+270ms busy: network`, `+276ms idle`, `+277ms idle (confirmed)`. */
  checks: string[];
  /** What the trackers saw during the wait (`native-module: RNCAsyncStorage.multiSet() +251ms→+266ms`). */
  activity?: string[];
}
