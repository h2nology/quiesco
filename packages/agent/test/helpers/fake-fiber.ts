/** Hand-built fiber trees shaped like React 19's (only the fields the adapter reads). */
import type { Fiber, FiberRoot } from '../../src/fiber-adapter/fiber';
import { WorkTag } from '../../src/fiber-adapter/fiber';
import { HOOK_KEY } from '../../src/fiber-adapter/hook';
import type { DevToolsHook } from '../../src/fiber-adapter/fiber';

export interface Spec {
  tag: number;
  type: unknown;
  props: unknown;
  stateNode?: unknown;
  children: Spec[];
}

let nextNativeTag = 2;
export const host = (type: string, props: Record<string, unknown> = {}, ...children: Spec[]): Spec => ({
  tag: WorkTag.HostComponent,
  type,
  props,
  // Shaped like Fabric's public instance (ReactNativeElement): view tag + getBoundingClientRect.
  stateNode: { __nativeTag: nextNativeTag++, ...(props['__rect'] ? { getBoundingClientRect: () => props['__rect'] } : {}) },
  children,
});
export const text = (s: string | number): Spec => ({ tag: WorkTag.HostText, type: null, props: s, children: [] });
export const composite = (type: unknown, ...children: Spec[]): Spec => ({ tag: 0, type, props: {}, children });
export const special = (tag: number, type: string, ...children: Spec[]): Spec => ({ tag, type, props: {}, children });

export function buildFiber(spec: Spec, parent: Fiber | null = null): Fiber {
  const f: Fiber = {
    tag: spec.tag,
    type: spec.type,
    key: null,
    memoizedProps: spec.props,
    stateNode: spec.stateNode ?? null,
    child: null,
    sibling: null,
    return: parent,
  };
  let prev: Fiber | null = null;
  for (const c of spec.children) {
    const cf = buildFiber(c, f);
    if (prev === null) f.child = cf;
    else prev.sibling = cf;
    prev = cf;
  }
  return f;
}

export function makeRoot(...children: Spec[]): FiberRoot {
  return {
    current: buildFiber({ tag: WorkTag.HostRoot, type: null, props: null, children }),
    pendingLanes: 0,
    callbackNode: null,
    cancelPendingCommit: null,
    timeoutHandle: -1,
  };
}

export function hookOf(target: Record<string, unknown>): DevToolsHook {
  return target[HOOK_KEY] as DevToolsHook;
}

/** Simulate a renderer module loading (inject) and committing `root`. */
export function renderWith(target: Record<string, unknown>, root: FiberRoot, packageName = 'react-native-renderer', version = '19.3.0'): number {
  const hook = hookOf(target);
  const id = hook.inject({ rendererPackageName: packageName, version, bundleType: 0 });
  hook.onCommitFiberRoot?.(id, root, 0, false);
  return id;
}

/** Minimal `scheduler` module: queue of tasks we can run by hand. */
export function fakeScheduler() {
  const queue: { cb: (didTimeout: boolean) => unknown; cancelled: boolean }[] = [];
  const mod = {
    unstable_scheduleCallback(_p: number, cb: (didTimeout: boolean) => unknown) {
      const task = { cb, cancelled: false };
      queue.push(task);
      return task;
    },
    unstable_cancelCallback(task: { cancelled: boolean }) {
      task.cancelled = true;
    },
  };
  /** Run the first queued task once; re-queue a returned continuation (like the real scheduler). */
  const runNext = (): void => {
    const task = queue.shift();
    if (!task || task.cancelled) return;
    const r = task.cb(false);
    if (typeof r === 'function') {
      task.cb = r as (d: boolean) => unknown;
      queue.unshift(task);
    }
  };
  return { mod, queue, runNext };
}
