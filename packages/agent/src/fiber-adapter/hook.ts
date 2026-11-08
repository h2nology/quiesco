/**
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__` integration (docs/spikes/01-fiber-query.md §1).
 *
 * - A hook already exists (debug builds: react-devtools-core installs it in InitializeCore; Expo web dev):
 *   WRAP its methods and call the originals, so React DevTools keeps working.
 * - No hook (release builds, web production): install a minimal one.
 *
 * Renderers look the hook up once, at module init. React Native 0.88 loads its renderer from
 * `setup-env` (run by Metro before the app entry), so `withQuiesco()` makes Metro run the agent's
 * early module (`src/early.ts`) before that. When the renderer is already registered on an existing
 * hook anyway, its roots are taken over from `getFiberRoots`; only roots rendered before the agent
 * (app code that ran first) are reported as a problem.
 */
import type { DevToolsHook, FiberRoot, RendererInternals } from './fiber';
import { isObject } from './fiber';
import type { RendererInfo, RendererKind } from './types';

export const HOOK_KEY = '__REACT_DEVTOOLS_GLOBAL_HOOK__';
const MARK = '__quiescoWrapped';

const SUPPORTED: Record<string, RendererKind> = {
  'react-native-renderer': 'native',
  'react-dom': 'web',
};
const SUPPORTED_MAJOR = 19;

export type CommitListener = (rendererID: number, root: FiberRoot) => void;

export interface HookState {
  source: 'existing' | 'installed';
  renderers: Map<number, RendererInfo>;
  roots: Map<number, Set<FiberRoot>>;
  /** Renderers that had already rendered roots when we installed (state set up before may be missed). */
  lateRenderers: RendererInfo[];
  commitListeners: Set<CommitListener>;
}

export function describeRenderer(id: number, internals: RendererInternals): RendererInfo {
  const packageName = internals.rendererPackageName ?? 'unknown';
  const version = internals.version ?? internals.reconcilerVersion ?? 'unknown';
  const kind = SUPPORTED[packageName];
  const major = Number.parseInt(version, 10);
  return {
    id,
    packageName,
    version,
    bundleType: internals.bundleType ?? 0,
    kind: kind ?? 'native',
    supported: kind !== undefined && major === SUPPORTED_MAJOR,
  };
}

function addRoot(state: HookState, rendererID: unknown, root: unknown): void {
  if (typeof rendererID !== 'number' || !isObject(root) || !('current' in root)) return;
  let set = state.roots.get(rendererID);
  if (set === undefined) state.roots.set(rendererID, (set = new Set()));
  set.add(root as unknown as FiberRoot);
}

function onCommit(state: HookState, rendererID: unknown, root: unknown): void {
  addRoot(state, rendererID, root);
  if (typeof rendererID !== 'number' || !isObject(root)) return;
  for (const l of state.commitListeners) {
    try {
      l(rendererID, root as unknown as FiberRoot);
    } catch {
      // A listener must never break the app's commit.
    }
  }
}

type HookMethod = (this: unknown, ...args: unknown[]) => unknown;

function wrapMethod(hook: DevToolsHook, name: string, before: (args: unknown[]) => void): void {
  const original = hook[name] as HookMethod | undefined;
  hook[name] = function (this: unknown, ...args: unknown[]) {
    try {
      before(args);
    } catch {
      // never break the app
    }
    return typeof original === 'function' ? original.apply(this, args) : undefined;
  };
}

/**
 * Install (or wrap) the DevTools hook on `target`. Idempotent per target: a second call returns the
 * state created by the first one (Fast Refresh re-evaluates modules).
 */
export function installHook(target: Record<string, unknown>): HookState {
  const existing = target[HOOK_KEY];
  if (isObject(existing) && isObject(existing[MARK])) return existing[MARK] as unknown as HookState;

  const state: HookState = {
    source: 'installed',
    renderers: new Map(),
    roots: new Map(),
    lateRenderers: [],
    commitListeners: new Set(),
  };

  if (isObject(existing) && typeof existing['inject'] === 'function') {
    const hook = existing as DevToolsHook;
    state.source = 'existing';
    const originalInject = hook.inject;
    hook.inject = function (this: unknown, internals: RendererInternals) {
      const id = originalInject.call(this, internals);
      state.renderers.set(id, describeRenderer(id, internals));
      return id;
    };
    if (hook.renderers instanceof Map) {
      for (const [id, internals] of hook.renderers) {
        const info = describeRenderer(id, internals);
        state.renderers.set(id, info);
        const roots = typeof hook.getFiberRoots === 'function' ? hook.getFiberRoots(id) : undefined;
        if (roots !== undefined && roots.size > 0) {
          for (const root of roots) addRoot(state, id, root);
          state.lateRenderers.push(info);
        }
      }
    }
    wrapMethod(hook, 'onScheduleFiberRoot', (a) => addRoot(state, a[0], a[1]));
    wrapMethod(hook, 'onCommitFiberRoot', (a) => onCommit(state, a[0], a[1]));
    hook[MARK] = state;
    return state;
  }

  let nextID = 1;
  const renderers = new Map<number, RendererInternals>();
  const hook: DevToolsHook = {
    supportsFiber: true,
    isDisabled: false,
    renderers,
    inject(internals) {
      const id = nextID++;
      renderers.set(id, internals);
      state.renderers.set(id, describeRenderer(id, internals));
      return id;
    },
    onScheduleFiberRoot(id, root) {
      addRoot(state, id, root);
    },
    onCommitFiberRoot(id, root) {
      onCommit(state, id, root);
    },
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    setStrictMode() {},
    checkDCE() {},
    [MARK]: state,
  };
  target[HOOK_KEY] = hook;
  return state;
}
