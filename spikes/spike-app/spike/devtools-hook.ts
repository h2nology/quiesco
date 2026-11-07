/**
 * S1/S2 spike: obtain React renderer + fiber roots via __REACT_DEVTOOLS_GLOBAL_HOOK__.
 *
 * - If a hook already exists (dev: react-devtools-core installs it in InitializeCore), wrap it.
 * - Otherwise (release builds, web), install a minimal hook. Must run before the renderer module loads.
 *
 * Must be the first import of the entry file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type CommitEvent = { kind: 'schedule' | 'commit' | 'postCommit'; rendererID: number; t: number };

type Listener = (e: CommitEvent, root: any) => void;

export const spikeState = {
  hookSource: 'none' as 'existing' | 'installed' | 'none',
  renderers: new Map<number, any>(),
  roots: new Map<number, Set<any>>(),
  events: [] as CommitEvent[],
  listeners: new Set<Listener>(),
};

const g: any = globalThis as any;

function record(kind: CommitEvent['kind'], rendererID: number, root: any) {
  if (root != null && kind !== 'postCommit') {
    let set = spikeState.roots.get(rendererID);
    if (!set) spikeState.roots.set(rendererID, (set = new Set()));
    set.add(root);
  }
  const e: CommitEvent = { kind, rendererID, t: Date.now() };
  spikeState.events.push(e);
  if (spikeState.events.length > 200) spikeState.events.shift();
  spikeState.listeners.forEach((l) => l(e, root));
}

function wrap(hook: any, name: string, kind: CommitEvent['kind'], rootArgIndex: number) {
  const orig = hook[name];
  hook[name] = function (...args: any[]) {
    try {
      record(kind, args[0], args[rootArgIndex]);
    } catch {
      // never break the app
    }
    return typeof orig === 'function' ? orig.apply(this, args) : undefined;
  };
}

if (g.__REACT_DEVTOOLS_GLOBAL_HOOK__ != null) {
  const hook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  spikeState.hookSource = 'existing';
  const origInject = hook.inject;
  hook.inject = function (internals: any) {
    const id = origInject.call(this, internals);
    spikeState.renderers.set(id, internals);
    return id;
  };
  // renderers injected before us (unlikely, renderer loads lazily) are in hook.renderers
  if (hook.renderers instanceof Map) hook.renderers.forEach((r: any, id: number) => spikeState.renderers.set(id, r));
  wrap(hook, 'onScheduleFiberRoot', 'schedule', 1);
  wrap(hook, 'onCommitFiberRoot', 'commit', 1);
  wrap(hook, 'onPostCommitFiberRoot', 'postCommit', 1);
} else {
  spikeState.hookSource = 'installed';
  let nextID = 1;
  g.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(internals: any) {
      const id = nextID++;
      this.renderers.set(id, internals);
      spikeState.renderers.set(id, internals);
      return id;
    },
    onScheduleFiberRoot(id: number, root: any) {
      record('schedule', id, root);
    },
    onCommitFiberRoot(id: number, root: any) {
      record('commit', id, root);
    },
    onPostCommitFiberRoot(id: number, root: any) {
      record('postCommit', id, root);
    },
    onCommitFiberUnmount() {},
    setStrictMode() {},
    checkDCE() {},
  };
}

g.__quiescoSpike = spikeState;
