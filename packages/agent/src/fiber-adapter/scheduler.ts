/**
 * Track pending React scheduler tasks (docs/spikes/02-react-idle.md §2, detector B).
 *
 * The renderer reads `unstable_scheduleCallback` / `unstable_cancelCallback` from the `scheduler`
 * module object at its own module init, so the exports must be replaced BEFORE the renderer loads.
 * Render work and `flushPassiveEffects` are both queued through it.
 */
import { isObject } from './fiber';

const MARK = '__quiescoSchedulerState';

export interface PendingTask {
  id: number;
  priority: number;
  since: number;
  /** Number of continuations returned so far (a continuation keeps the task pending). */
  continued: number;
}

export interface SchedulerState {
  patched: boolean;
  pending: Map<unknown, PendingTask>;
  scheduledTotal: number;
}

type Callback = (this: unknown, didTimeout: boolean) => unknown;
type ScheduleFn = (this: unknown, priority: number, callback: Callback, options?: unknown) => unknown;
type CancelFn = (this: unknown, task: unknown) => unknown;

/** Patch a `scheduler` module object in place. Idempotent per module object. */
export function patchScheduler(scheduler: unknown, now: () => number = Date.now): SchedulerState {
  if (!isObject(scheduler)) return { patched: false, pending: new Map(), scheduledTotal: 0 };
  const existing = scheduler[MARK];
  if (isObject(existing)) return existing as unknown as SchedulerState;

  const origSchedule = scheduler['unstable_scheduleCallback'] as ScheduleFn | undefined;
  const origCancel = scheduler['unstable_cancelCallback'] as CancelFn | undefined;
  const state: SchedulerState = { patched: false, pending: new Map(), scheduledTotal: 0 };
  if (typeof origSchedule !== 'function' || typeof origCancel !== 'function') return state;

  let nextId = 1;
  scheduler['unstable_scheduleCallback'] = function (this: unknown, priority: number, callback: Callback, options?: unknown) {
    const info: PendingTask = { id: nextId++, priority, since: now(), continued: 0 };
    const wrap = (cb: Callback): Callback =>
      function (this: unknown, didTimeout: boolean) {
        let result: unknown;
        try {
          result = cb.call(this, didTimeout);
        } finally {
          if (typeof result !== 'function') state.pending.delete(task);
        }
        if (typeof result === 'function') {
          info.continued++;
          return wrap(result as Callback);
        }
        return result;
      };
    const task: unknown = origSchedule.call(this, priority, wrap(callback), options);
    state.pending.set(task, info);
    state.scheduledTotal++;
    return task;
  };
  scheduler['unstable_cancelCallback'] = function (this: unknown, task: unknown) {
    state.pending.delete(task);
    return origCancel.call(this, task);
  };
  scheduler[MARK] = state;
  state.patched = true;
  return state;
}
