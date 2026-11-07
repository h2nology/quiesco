/**
 * Frame-stable tracker (requirements.md §6.2-5): the element tree's structure hash (type, testID,
 * text, rounded rect) is unchanged for N consecutive frames (default 2). Catches UI-thread animations
 * (e.g. Reanimated) that are invisible to the JS-side trackers.
 *
 * Sampling runs only while a waitForIdle is in progress (beginWait / endWait), so idle apps do not
 * pay for hashing the tree every frame. Outside a wait it reports idle.
 */
import { SyncDefaults } from '@quiesco/protocol';

import type { IdleTracker } from './tracker';

export interface FrameStableTrackerOptions {
  /** Structure hash of the current element tree. */
  hash: () => string;
  frames?: number;
  /** Default: `globalThis.requestAnimationFrame`. */
  requestFrame?: (cb: () => void) => unknown;
  cancelFrame?: (id: unknown) => void;
}

export class FrameStableTracker implements IdleTracker {
  readonly name = 'frame-stable';
  private frames: number;
  private waiting = 0;
  private frameId: unknown = null;
  private last: string | null = null;
  /** Consecutive sampled frames with the same hash, including the first. */
  private same = 0;
  private sampled = 0;

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
    return [`element tree changing: stable for ${this.same}/${this.frames} frames`];
  }

  install(): void {}

  uninstall(): void {
    this.waiting = 0;
    this.stop();
  }

  beginWait(): void {
    if (this.waiting++ > 0) return;
    this.last = null;
    this.same = 0;
    this.sampled = 0;
    this.schedule();
  }

  endWait(): void {
    if (this.waiting === 0 || --this.waiting > 0) return;
    this.stop();
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
    let h: string;
    try {
      h = this.options.hash();
    } catch (e) {
      h = `error:${String(e)}`;
    }
    this.sampled++;
    this.same = h === this.last ? this.same + 1 : 1;
    this.last = h;
  }

  private stop(): void {
    if (this.frameId !== null) {
      const cancel = this.options.cancelFrame ?? (globalThis as { cancelAnimationFrame?: (id: unknown) => void }).cancelAnimationFrame;
      cancel?.(this.frameId);
      this.frameId = null;
    }
  }
}
