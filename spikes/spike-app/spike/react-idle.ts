/** S2 spike: candidate React idle detectors. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { allRoots } from './fiber-query';
import { schedulerState } from './scheduler-tracker';

/** A: inspect FiberRoot fields. */
export function rootFieldsBusy(): string[] {
  const busy: string[] = [];
  for (const root of allRoots()) {
    if (root.pendingLanes !== 0) busy.push(`pendingLanes=0b${root.pendingLanes.toString(2)}`);
    if (root.callbackNode != null) busy.push('callbackNode');
    if (root.cancelPendingCommit != null) busy.push('cancelPendingCommit');
    if (root.timeoutHandle !== -1) busy.push(`timeoutHandle=${root.timeoutHandle}`);
  }
  return busy;
}

/** B: pending scheduler tasks. */
export function schedulerBusy(): string[] {
  const out: string[] = [];
  schedulerState.pending.forEach((t) => out.push(`task#${t.id} p${t.priority} ${Date.now() - t.since}ms`));
  return out;
}
