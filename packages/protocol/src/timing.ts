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
