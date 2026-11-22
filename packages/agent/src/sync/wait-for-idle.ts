/**
 * waitForIdle (requirements.md §6.2): all enabled trackers idle in two consecutive checks that run
 * in DIFFERENT macrotasks (docs/spikes/02-react-idle.md §4 — a single check misreports idle when a
 * batch of expired timers runs without draining microtasks in between).
 */
import { SyncDefaults } from '@quiesco/protocol';
import type { TrackerState, WaitEnd } from '@quiesco/protocol';

import { QuiescoError } from '../errors';
import type { Clock, IdleTracker } from './tracker';
import { realClock } from './tracker';

export interface WaitForIdleOptions {
  timeoutMs?: number;
  /** Delay between checks while busy. The confirmation check always runs in the very next macrotask. */
  pollIntervalMs?: number;
  /**
   * Timeout of the whole call this wait belongs to (an action waits with what is left of it), used in
   * the SYNC_TIMEOUT message. Default: `timeoutMs`.
   */
  reportedTimeoutMs?: number;
}

const DEFAULT_POLL_MS = 16;
/** While the same trackers stay busy, what they are busy with is read again at most this often. */
const DESCRIBE_EVERY_MS = 100;
/** A tracker's busy reasons in a wait's result, at most this long. */
const MAX_BUSY_CHARS = 200;

/** Checks kept for the record of how a wait ended (issue #107). */
const LAST_CHECKS = 4;
/**
 * A SYNC_TIMEOUT also lists the trackers idle at the timeout but busy this shortly before it (issue #110:
 * a tree that changes every 50 ms is stable for a frame or two between changes, and the timeout can land
 * there).
 */
const RECENTLY_BUSY_MS = 1_000;

export interface WaitResult {
  waitedMs: number;
  /**
   * What the busy trackers were busy with at the last check that found the app busy (`native-module:
   * RNCDatePicker.open() 1990ms`, issue #93): what the wait ended on. Left out when it was idle at once.
   */
  busy?: string[];
  /** How the wait ended (issue #107). */
  end: WaitEnd;
}
const NO_NAMES: ReadonlySet<string> = new Set();

export class SyncEngine {
  private installed = false;
  private disabled = new Set<string>();
  /** Trackers that cannot settle right now (e.g. no frames while the app is in the background). */
  private skipped: () => ReadonlySet<string> = () => NO_NAMES;
  private inBackground: () => boolean = () => false;
  private onBackgroundChange: ((wake: () => void) => () => void) | undefined;
  /** The sleeps of the pending waits: `wake()` ends them early. */
  private readonly sleepers = new Set<() => void>();

  constructor(
    readonly trackers: readonly IdleTracker[],
    private readonly clock: Clock = realClock,
  ) {}

  install(): void {
    if (this.installed) return;
    for (const t of this.trackers) t.install();
    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed) return;
    for (const t of this.trackers) t.uninstall();
    this.installed = false;
  }

  /** Trackers listed as `false` are ignored by waitForIdle / getIdleState (they stay installed). */
  setEnabled(enabled: Readonly<Record<string, boolean | undefined>>): void {
    this.disabled = new Set(Object.entries(enabled).filter(([, on]) => on === false).map(([name]) => name));
  }

  /**
   * Trackers named by `fn()` at check time count as idle (Phase 6.5: in the background Android pauses
   * RN timers and no frames are drawn, so they would never settle).
   */
  setSkipped(fn: () => ReadonlySet<string>): void {
    this.skipped = fn;
  }

  /**
   * While `inBackground()`, Android pauses the JS timers (findings 6.7 batch C: a permission dialog is
   * another activity), so a wait sleeping on a timer would neither end nor time out. `onChange` wakes it
   * (AppState events still arrive), so do the host's messages (`wake()`, its `tick` every 500 ms while a
   * call is pending, issue #66); each wake checks the trackers and the timeout again. In the background
   * it returns as soon as every active tracker is idle, without the confirmation check in a later
   * macrotask (that needs a timer; nothing runs anyway).
   */
  setBackground(inBackground: () => boolean, onChange?: (wake: () => void) => () => void): void {
    this.inBackground = inBackground;
    this.onBackgroundChange = onChange;
  }

  /** End the current sleep of every pending wait now: it checks the trackers and its timeout again. */
  wake(): void {
    const sleepers = [...this.sleepers];
    this.sleepers.clear();
    for (const s of sleepers) s();
  }

  private active(): IdleTracker[] {
    const skipped = safe(() => this.skipped(), NO_NAMES);
    return this.trackers.filter((t) => !this.disabled.has(t.name) && !skipped.has(t.name));
  }

  getIdleState(): TrackerState[] {
    return this.active().map((t) => {
      const idle = safe(() => t.isIdle(), false);
      const lastWait = safe(() => t.describeLastWait?.() ?? [], []);
      return {
        name: t.name,
        idle,
        busy: idle ? [] : safe(() => t.describeBusy(), ['describeBusy() threw']),
        ...(idle && lastWait.length > 0 ? { lastWait } : {}),
      };
    });
  }

  async waitForIdle(options: WaitForIdleOptions = {}): Promise<WaitResult> {
    const timeoutMs = options.timeoutMs ?? SyncDefaults.timeoutMs;
    const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    const start = this.clock.now();
    const trackers = this.active();
    let wake: (() => void) | null = null;
    const unsubscribe = safe(() => this.onBackgroundChange?.(() => wake?.()), undefined);
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          this.sleepers.delete(done);
          resolve();
        };
        wake = done;
        this.sleepers.add(done);
        this.clock.setTimeout(done, ms);
      });
    let busy: string[] | undefined;
    let described = { names: '', at: -Infinity };
    /** Per tracker: when a check last found it busy, and its reasons then (issue #110). */
    const lastBusy = new Map<string, { at: number; reasons: string[] }>();
    const noteBusy = (busyNow: readonly IdleTracker[]): void => {
      const names = busyNow.map((t) => t.name).join();
      const now = this.clock.now();
      if (names === described.names && now - described.at < DESCRIBE_EVERY_MS) return;
      described = { names, at: now };
      busy = busyNow.map((t) => {
        const reasons = safe(() => t.describeBusy(), ['describeBusy() threw']);
        lastBusy.set(t.name, { at: now, reasons });
        return `${t.name}: ${truncate(reasons.join('; '))}`;
      });
    };
    const checks: string[] = [];
    const check = (confirming: boolean): IdleTracker[] => {
      const busyNow = this.busyTrackers();
      const now = this.clock.now();
      for (const t of busyNow) {
        const seen = lastBusy.get(t.name);
        if (seen !== undefined) seen.at = now;
      }
      const at = `+${now - start}ms`;
      checks.push(busyNow.length > 0 ? `${at} busy: ${busyNow.map((t) => t.name).join(', ')}` : `${at} idle${confirming ? ' (confirmed)' : ''}`);
      if (checks.length > LAST_CHECKS) checks.shift();
      return busyNow;
    };
    const ended = (): WaitEnd => {
      const now = this.clock.now();
      const activity = trackers.flatMap((t) => safe(() => t.describeActivity?.(start, now) ?? [], []).map((a) => `${t.name}: ${a}`));
      return { endedAt: now, checks: [...checks], ...(activity.length > 0 ? { activity } : {}) };
    };
    const idle = (): WaitResult => {
      const end = ended();
      return { waitedMs: end.endedAt - start, ...(busy !== undefined ? { busy } : {}), end };
    };
    let timedOut = false;
    for (const t of trackers) t.beginWait?.();
    try {
      for (;;) {
        let busyNow = check(false);
        if (busyNow.length === 0) {
          if (safe(() => this.inBackground(), false)) return idle();
          await sleep(0);
          busyNow = check(true);
          if (busyNow.length === 0) return idle();
        }
        noteBusy(busyNow);
        const elapsed = this.clock.now() - start;
        if (elapsed >= timeoutMs) {
          timedOut = true;
          throw this.timeoutError(options.reportedTimeoutMs ?? timeoutMs, elapsed, lastBusy, ended());
        }
        await sleep(Math.min(pollMs, timeoutMs - elapsed));
      }
    } finally {
      if (wake !== null) this.sleepers.delete(wake);
      wake = null;
      safe(() => unsubscribe?.(), undefined);
      for (const t of trackers) t.endWait?.(timedOut);
    }
  }

  private busyTrackers(): IdleTracker[] {
    return this.active().filter((t) => !safe(() => t.isIdle(), false));
  }

  /**
   * The trackers busy at the timeout, then those idle at that instant but busy shortly before it (issue
   * #110), with what they were busy with then; and how the wait ended.
   */
  private timeoutError(
    timeoutMs: number,
    waitedMs: number,
    lastBusy: ReadonlyMap<string, { at: number; reasons: string[] }>,
    syncEnd: WaitEnd,
  ): QuiescoError<'SYNC_TIMEOUT'> {
    const now = this.clock.now();
    const states = this.getIdleState();
    const busy: TrackerState[] = states.filter((s) => !s.idle);
    for (const s of states) {
      const seen = lastBusy.get(s.name);
      if (!s.idle || seen === undefined || now - seen.at > RECENTLY_BUSY_MS) continue;
      busy.push({ name: s.name, idle: true, busy: seen.reasons, idleForMs: now - seen.at });
    }
    const lines = busy.map((s) => {
      const when = s.idle ? ` (idle at the timeout, busy ${s.idleForMs}ms before it)` : '';
      return `  - ${s.name}${when}: ${s.busy.length > 0 ? s.busy.join('; ') : 'busy'}`;
    });
    const waited = waitedMs < timeoutMs ? ` (waited ${waitedMs}ms for idle after the action)` : '';
    return new QuiescoError('SYNC_TIMEOUT', `App did not become idle within the ${timeoutMs}ms timeout${waited}. Busy:\n${lines.join('\n')}`, {
      timeoutMs,
      busy,
      syncEnd,
    });
  }

}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function truncate(text: string): string {
  return text.length <= MAX_BUSY_CHARS ? text : `${text.slice(0, MAX_BUSY_CHARS - 1)}…`;
}
