/**
 * Frame-stable tracker (requirements.md §6.2-5): the element tree's structure snapshot (type, testID,
 * text, rounded rect of every host node) is unchanged for N consecutive frames (default 2). Catches
 * UI-thread animations (e.g. Reanimated) that are invisible to the JS-side trackers.
 *
 * Sampling runs only while a waitForIdle is in progress (beginWait / endWait), so idle apps do not
 * pay for snapshotting the tree every frame. Outside a wait it reports idle.
 *
 * When the tree never settles, describeBusy() says how many frames were sampled in how long (very few
 * frames means a starved UI thread, not an animation) and which node differed between the last two
 * different frames, so a sync timeout names the element that keeps changing.
 */
import { SyncDefaults } from '@quiesco/protocol';

import type { IdleTracker } from './tracker';

export interface FrameStableTrackerOptions {
  /** Structure snapshot of the current element tree, one line per host node. */
  snapshot: () => readonly string[];
  frames?: number;
  /** Default: `globalThis.requestAnimationFrame`. */
  requestFrame?: (cb: () => void) => unknown;
  cancelFrame?: (id: unknown) => void;
  /** Clock for the diagnostics. Default: `Date.now`. */
  now?: () => number;
}

const MAX_LINE = 120;

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const clip = (line: string | undefined): string =>
  line === undefined ? '(none)' : line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line;

/** Where two snapshots first differ, as a short human-readable line. */
export function describeChange(before: readonly string[], after: readonly string[]): string {
  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  const count = before.length === after.length ? '' : `node count ${before.length} → ${after.length}; `;
  return `${count}first difference at node ${i}: ${clip(before[i])} → ${clip(after[i])}`;
}

export class FrameStableTracker implements IdleTracker {
  readonly name = 'frame-stable';
  private frames: number;
  private waiting = 0;
  private frameId: unknown = null;
  private last: readonly string[] | null = null;
  /** The snapshot before the most recent change (for describeBusy). */
  private beforeChange: readonly string[] | null = null;
  /** Consecutive sampled frames with the same snapshot, including the first. */
  private same = 0;
  private sampled = 0;
  private startedAt = 0;

  constructor(private readonly options: FrameStableTrackerOptions) {
    this.frames = Math.max(1, options.frames ?? SyncDefaults.stableFrames);
  }

  setFrames(frames: number): void {
    this.frames = Math.max(1, frames);
  }

  isIdle(): boolean {
    return this.waiting === 0 || this.same >= this.frames;
  }

  describeBusy(): string[] {
    if (this.isIdle()) return [];
    if (this.sampled === 0) return ['no frame rendered yet (is the app in the foreground?)'];
    const elapsed = this.now() - this.startedAt;
    const lines = [`element tree changing: stable for ${this.same}/${this.frames} frames (${this.sampled} frames sampled in ${elapsed}ms)`];
    if (this.beforeChange !== null && this.last !== null) lines.push(`last change: ${describeChange(this.beforeChange, this.last)}`);
    return lines;
  }

  install(): void {}

  uninstall(): void {
    this.waiting = 0;
    this.stop();
  }

  beginWait(): void {
    if (this.waiting++ > 0) return;
    this.last = null;
    this.beforeChange = null;
    this.same = 0;
    this.sampled = 0;
    this.startedAt = this.now();
    this.schedule();
  }

  endWait(): void {
    if (this.waiting === 0 || --this.waiting > 0) return;
    this.stop();
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private schedule(): void {
    const raf = this.options.requestFrame ?? (globalThis as { requestAnimationFrame?: (cb: () => void) => unknown }).requestAnimationFrame;
    if (raf === undefined) return;
    this.frameId = raf(() => {
      this.frameId = null;
      if (this.waiting === 0) return;
      this.sample();
      this.schedule();
    });
  }

  private sample(): void {
    let snap: readonly string[];
    try {
      snap = this.options.snapshot();
    } catch (e) {
      snap = [`error: ${String(e)}`];
    }
    this.sampled++;
    if (this.last !== null && sameLines(snap, this.last)) {
      this.same++;
    } else {
      if (this.last !== null) this.beforeChange = this.last;
      this.same = 1;
    }
    this.last = snap;
  }

  private stop(): void {
    if (this.frameId !== null) {
      const cancel = this.options.cancelFrame ?? (globalThis as { cancelAnimationFrame?: (id: unknown) => void }).cancelAnimationFrame;
      cancel?.(this.frameId);
      this.frameId = null;
    }
  }
}
