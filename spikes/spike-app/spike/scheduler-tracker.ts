/**
 * S2 spike: track pending React scheduler tasks by patching the `scheduler` module exports
 * BEFORE the renderer reads them (the renderer captures unstable_scheduleCallback at module init).
 * Must be imported right after devtools-hook, before anything that loads the renderer.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Scheduler: any = require('scheduler');

export type PendingTask = { id: number; priority: number; since: number; continued: number };

export const schedulerState = {
  patched: false,
  pending: new Map<any, PendingTask>(),
  scheduledTotal: 0,
  runLog: [] as { id: number; p: number; at: number; dur: number; cont: boolean }[],
};

let nextId = 1;

if (!Scheduler.__quiescoPatched) {
  const origSchedule = Scheduler.unstable_scheduleCallback;
  const origCancel = Scheduler.unstable_cancelCallback;
  Scheduler.unstable_scheduleCallback = function (priority: number, callback: any, options?: any) {
    const info: PendingTask = { id: nextId++, priority, since: Date.now(), continued: 0 };
    let task: any;
    const wrapCb = (cb: any) =>
      function (this: any, didTimeout: boolean) {
        let result: any;
        const st = Date.now();
        try {
          result = cb.call(this, didTimeout);
        } finally {
          schedulerState.runLog.push({ id: info.id, p: priority, at: st, dur: Date.now() - st, cont: typeof result === 'function' });
          if (schedulerState.runLog.length > 500) schedulerState.runLog.shift();
          if (typeof result !== 'function') schedulerState.pending.delete(task);
        }
        if (typeof result === 'function') {
          info.continued++;
          return wrapCb(result); // continuation keeps the task pending
        }
        return result;
      };
    task = origSchedule.call(this, priority, wrapCb(callback), options);
    schedulerState.pending.set(task, info);
    schedulerState.scheduledTotal++;
    return task;
  };
  Scheduler.unstable_cancelCallback = function (task: any) {
    schedulerState.pending.delete(task);
    return origCancel.call(this, task);
  };
  Scheduler.__quiescoPatched = true;
  schedulerState.patched = true;
}
