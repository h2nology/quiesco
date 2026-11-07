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
}

const DEFAULT_POLL_MS = 16;

export class SyncEngine {
  private installed = false;
  private disabled = new Set<string>();

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

  private active(): IdleTracker[] {
    return this.trackers.filter((t) => !this.disabled.has(t.name));
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
    for (const t of trackers) t.beginWait?.();
    try {
      for (;;) {
        if (this.allIdle()) {
          await this.sleep(0);
          if (this.allIdle()) return { waitedMs: this.clock.now() - start };
        }
        const elapsed = this.clock.now() - start;
        if (elapsed >= timeoutMs) throw this.timeoutError(timeoutMs);
        await this.sleep(Math.min(pollMs, timeoutMs - elapsed));
      }
    } finally {
      for (const t of trackers) t.endWait?.();
    }
  }

  private allIdle(): boolean {
    return this.active().every((t) => safe(() => t.isIdle(), false));
  }

  private timeoutError(timeoutMs: number): QuiescoError<'SYNC_TIMEOUT'> {
    const busy = this.getIdleState().filter((s) => !s.idle);
    const lines = busy.map((s) => `  - ${s.name}: ${s.busy.length > 0 ? s.busy.join('; ') : 'busy'}`);
    return new QuiescoError('SYNC_TIMEOUT', `App did not become idle within ${timeoutMs}ms. Busy:\n${lines.join('\n')}`, {
      timeoutMs,
      busy,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.clock.setTimeout(resolve, ms);
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
