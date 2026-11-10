/**
 * waitForIdle (requirements.md §6.2): all enabled trackers idle in two consecutive checks that run
 * in DIFFERENT macrotasks (docs/spikes/02-react-idle.md §4 — a single check misreports idle when a
 * batch of expired timers runs without draining microtasks in between).
 */
import { SyncDefaults } from '@quiesco/protocol';
import type { TrackerState } from '@quiesco/protocol';

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
const NO_NAMES: ReadonlySet<string> = new Set();

export class SyncEngine {
  private installed = false;
  private disabled = new Set<string>();
  /** Trackers that cannot settle right now (e.g. no frames while the app is in the background). */
  private skipped: () => ReadonlySet<string> = () => NO_NAMES;
  private inBackground: () => boolean = () => false;
  private onBackgroundChange: ((wake: () => void) => () => void) | undefined;

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
   * (AppState events still arrive), and in the background it returns as soon as every active tracker is
   * idle, without the confirmation check in a later macrotask (that needs a timer; nothing runs anyway).
   */
  setBackground(inBackground: () => boolean, onChange?: (wake: () => void) => () => void): void {
    this.inBackground = inBackground;
    this.onBackgroundChange = onChange;
  }

  private active(): IdleTracker[] {
    const skipped = safe(() => this.skipped(), NO_NAMES);
    return this.trackers.filter((t) => !this.disabled.has(t.name) && !skipped.has(t.name));
  }

  getIdleState(): TrackerState[] {
    return this.active().map((t) => {
      const idle = safe(() => t.isIdle(), false);
      return { name: t.name, idle, busy: idle ? [] : safe(() => t.describeBusy(), ['describeBusy() threw']) };
    });
  }

  async waitForIdle(options: WaitForIdleOptions = {}): Promise<{ waitedMs: number }> {
    const timeoutMs = options.timeoutMs ?? SyncDefaults.timeoutMs;
    const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    const start = this.clock.now();
    const trackers = this.active();
    let wake: (() => void) | null = null;
    const unsubscribe = safe(() => this.onBackgroundChange?.(() => wake?.()), undefined);
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        wake = resolve;
        this.clock.setTimeout(resolve, ms);
      });
    for (const t of trackers) t.beginWait?.();
    try {
      for (;;) {
        if (this.allIdle()) {
          if (safe(() => this.inBackground(), false)) return { waitedMs: this.clock.now() - start };
          await sleep(0);
          if (this.allIdle()) return { waitedMs: this.clock.now() - start };
        }
        const elapsed = this.clock.now() - start;
        if (elapsed >= timeoutMs) throw this.timeoutError(options.reportedTimeoutMs ?? timeoutMs, elapsed);
        await sleep(Math.min(pollMs, timeoutMs - elapsed));
      }
    } finally {
      wake = null;
      safe(() => unsubscribe?.(), undefined);
      for (const t of trackers) t.endWait?.();
    }
  }

  private allIdle(): boolean {
    return this.active().every((t) => safe(() => t.isIdle(), false));
  }

  private timeoutError(timeoutMs: number, waitedMs: number): QuiescoError<'SYNC_TIMEOUT'> {
    const busy = this.getIdleState().filter((s) => !s.idle);
    const lines = busy.map((s) => `  - ${s.name}: ${s.busy.length > 0 ? s.busy.join('; ') : 'busy'}`);
    const waited = waitedMs < timeoutMs ? ` (waited ${waitedMs}ms for idle after the action)` : '';
    return new QuiescoError('SYNC_TIMEOUT', `App did not become idle within the ${timeoutMs}ms timeout${waited}. Busy:\n${lines.join('\n')}`, {
      timeoutMs,
      busy,
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
