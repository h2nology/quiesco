/**
 * Pending timer tracker (requirements.md §6.2-2): counts `setTimeout` with delay ≤ threshold
 * (default 1500ms). `setInterval` is only counted when `countIntervals` is set.
 * The agent's own timers use `realClock` (captured before patching) and are never counted.
 */
import { SyncDefaults } from '@quiesco/protocol';

import type { IdleTracker } from './tracker';
import { isFunction, patch } from './tracker';

type SetFn = (this: unknown, cb: unknown, ms?: number, ...args: unknown[]) => unknown;
type ClearFn = (this: unknown, id: unknown) => void;

export interface TimerGlobals {
  setTimeout: SetFn;
  clearTimeout: ClearFn;
  setInterval?: SetFn;
  clearInterval?: ClearFn;
}

export interface TimerTrackerOptions {
  target?: TimerGlobals;
  thresholdMs?: number;
  countIntervals?: boolean;
  now?: () => number;
}

interface PendingTimer {
  kind: 'setTimeout' | 'setInterval';
  delay: number;
  since: number;
  name: string;
}

export class TimerTracker implements IdleTracker {
  readonly name = 'timer';
  private readonly pending = new Map<unknown, PendingTimer>();
  private readonly restores: (() => void)[] = [];
  private readonly target: TimerGlobals;
  private threshold: number;
  private countIntervals: boolean;
  private readonly now: () => number;

  constructor(options: TimerTrackerOptions = {}) {
    this.target = options.target ?? (globalThis as unknown as TimerGlobals);
    this.threshold = options.thresholdMs ?? SyncDefaults.timerThresholdMs;
    this.countIntervals = options.countIntervals ?? SyncDefaults.countIntervals;
    this.now = options.now ?? Date.now;
  }

  /** Applies to timers created from now on. */
  configure(options: { thresholdMs?: number; countIntervals?: boolean }): void {
    if (options.thresholdMs !== undefined) this.threshold = options.thresholdMs;
    if (options.countIntervals !== undefined) {
      this.countIntervals = options.countIntervals;
      if (!this.countIntervals) for (const [id, p] of this.pending) if (p.kind === 'setInterval') this.pending.delete(id);
    }
  }

  isIdle(): boolean {
    return this.pending.size === 0;
  }

  describeBusy(): string[] {
    const t = this.now();
    return [...this.pending.values()].map((p) => {
      const left = p.kind === 'setTimeout' ? `, fires in ${Math.max(0, p.delay - (t - p.since))}ms` : '';
      return `${p.kind}(${p.name}, ${p.delay}ms)${left}`;
    });
  }

  install(): void {
    if (this.restores.length > 0) return;
    const self = this;
    const t = this.target;
    this.restores.push(
      patch(t, 'setTimeout', (original) =>
        function (this: unknown, cb: unknown, ms?: number, ...args: unknown[]) {
          const delay = Number(ms ?? 0) || 0;
          if (!isFunction(cb) || delay > self.threshold) return original.call(this, cb, ms, ...args);
          const wrapped = function (this: unknown, ...a: unknown[]) {
            self.pending.delete(id);
            return (cb as (...x: unknown[]) => unknown).apply(this, a);
          };
          const id: unknown = original.call(this, wrapped, ms, ...args);
          self.pending.set(id, { kind: 'setTimeout', delay, since: self.now(), name: cb.name || 'anonymous' });
          return id;
        },
      ),
      patch(t, 'clearTimeout', (original) =>
        function (this: unknown, id: unknown) {
          self.pending.delete(id);
          return original.call(this, id);
        },
      ),
    );
    if (isFunction(t.setInterval) && isFunction(t.clearInterval)) {
      const it = t as Required<TimerGlobals>;
      this.restores.push(
        patch(it, 'setInterval', (original) =>
          function (this: unknown, cb: unknown, ms?: number, ...args: unknown[]) {
            const delay = Number(ms ?? 0) || 0;
            const id = original.call(this, cb, ms, ...args);
            if (self.countIntervals && isFunction(cb) && delay <= self.threshold) {
              self.pending.set(id, { kind: 'setInterval', delay, since: self.now(), name: cb.name || 'anonymous' });
            }
            return id;
          },
        ),
        patch(it, 'clearInterval', (original) =>
          function (this: unknown, id: unknown) {
            self.pending.delete(id);
            return original.call(this, id);
          },
        ),
      );
    }
  }

  uninstall(): void {
    while (this.restores.length > 0) this.restores.pop()?.();
    this.pending.clear();
  }
}
