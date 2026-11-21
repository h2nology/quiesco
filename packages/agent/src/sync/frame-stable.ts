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
 * different frames, so a sync timeout names the element that keeps changing. It also keeps the latest
 * changes, and says when the same node keeps changing back and forth (issue #102: a FlatList adding and
 * removing a cell at the edge of its render window), which one "last change" cannot show.
 * The reasons of a wait that ended busy stay available (describeLastWait) for the failure evidence,
 * which is collected after the wait.
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
/** Changes listed in "recent changes". */
const HISTORY = 6;
/** Changes kept to recognize one that keeps going back and forth. */
const WINDOW = 20;
/** Times each way the same node must change back and forth before it is reported (issue #102). */
const BACK_AND_FORTH = 2;

interface Change {
  /** ms since the wait began. */
  at: number;
  before: number;
  after: number;
  index: number;
  /** The first differing node before and after (clipped). */
  from: string;
  to: string;
}

function firstDifference(a: readonly string[], b: readonly string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const clip = (line: string | undefined): string =>
  line === undefined ? '(none)' : line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line;

/** Where two snapshots first differ, as a short human-readable line. */
export function describeChange(before: readonly string[], after: readonly string[]): string {
  const i = firstDifference(before, after);
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
  private changes = 0;
  /** The latest changes, oldest first (at most WINDOW). */
  private recent: Change[] = [];
  private lastWait: string[] = [];

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
    return this.isIdle() ? [] : this.describe();
  }

  /** What describeBusy() said when the latest wait for idle ended while the tree was still changing. */
  describeLastWait(): string[] {
    return this.lastWait;
  }

  private describe(): string[] {
    if (this.sampled === 0) return ['no frame rendered yet (is the app in the foreground?)'];
    const elapsed = this.now() - this.startedAt;
    const lines = [`element tree changing: stable for ${this.same}/${this.frames} frames (${this.sampled} frames sampled in ${elapsed}ms)`];
    if (this.beforeChange === null || this.last === null) return lines;
    lines.push(`last change: ${describeChange(this.beforeChange, this.last)}`);
    const backAndForth = this.describeBackAndForth();
    if (backAndForth !== undefined) lines.push(backAndForth);
    const shown = this.recent.slice(-HISTORY).map((c) => `+${c.at}ms ${c.before === c.after ? `${c.after} nodes` : `${c.before}→${c.after} nodes`} @${c.index}`);
    lines.push(`recent changes (${this.changes} in ${elapsed}ms): ${shown.join(', ')}`);
    return lines;
  }

  /**
   * The node whose change (first difference, from → to) went back and forth most often among the latest
   * changes, both ways at least BACK_AND_FORTH times. Other parts of the tree may change in between (a
   * list rendering more rows when an item above it appears), so whole trees are not compared.
   */
  private describeBackAndForth(): string | undefined {
    const pairs = new Map<string, { forth: Change; there: number; back: number; nodes: boolean }>();
    for (const c of this.recent) {
      const there = pairs.get(`${c.from}\n${c.to}`);
      const back = there === undefined ? pairs.get(`${c.to}\n${c.from}`) : undefined;
      const pair = there ?? back ?? { forth: c, there: 0, back: 0, nodes: false };
      if (there === undefined && back === undefined) pairs.set(`${c.from}\n${c.to}`, pair);
      if (back === undefined) pair.there++;
      else pair.back++;
      pair.nodes ||= c.before !== c.after;
    }
    let best: { forth: Change; there: number; back: number; nodes: boolean } | undefined;
    for (const p of pairs.values()) {
      if (Math.min(p.there, p.back) >= BACK_AND_FORTH && (best === undefined || p.there + p.back > best.there + best.back)) best = p;
    }
    if (best === undefined) return undefined;
    const what =
      `the same change went back and forth in ${best.there + best.back} of the last ${this.recent.length} changes ` +
      `(since +${best.forth.at}ms): ${best.forth.from} ↔ ${best.forth.to}`;
    if (!best.nodes) return `${what}: something toggles, e.g. a blinking cursor or indicator; if it is decoration, list it in sync.ignoreElements`;
    return (
      `${what}, an element added and removed: a list adding and removing an item at the edge of its render window? ` +
      'A FlatList / VirtualizedList without getItemLayout can do this when row heights differ; getItemLayout or fixed row heights usually stop it'
    );
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
    this.changes = 0;
    this.recent = [];
    this.schedule();
  }

  endWait(): void {
    if (this.waiting === 0 || --this.waiting > 0) return;
    this.lastWait = this.same >= this.frames ? [] : this.describe();
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
      if (this.last !== null) this.noteChange(this.last, snap);
      this.same = 1;
    }
    this.last = snap;
  }

  private noteChange(before: readonly string[], after: readonly string[]): void {
    const index = firstDifference(before, after);
    this.beforeChange = before;
    this.changes++;
    this.recent.push({ at: this.now() - this.startedAt, before: before.length, after: after.length, index, from: clip(before[index]), to: clip(after[index]) });
    if (this.recent.length > WINDOW) this.recent.shift();
  }

  private stop(): void {
    if (this.frameId !== null) {
      const cancel = this.options.cancelFrame ?? (globalThis as { cancelAnimationFrame?: (id: unknown) => void }).cancelAnimationFrame;
      cancel?.(this.frameId);
      this.frameId = null;
    }
  }
}
