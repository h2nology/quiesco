/**
 * Minimal shapes of React's internal objects. Private to fiber-adapter.
 * Field names follow React 19 (ReactInternalTypes.js / ReactFiberRoot.js); verified on React 19.3.0
 * with react-native-renderer (Fabric) and react-dom (docs/spikes/01, 02, 07).
 */

/** WorkTag values from ReactWorkTags.js. */
export const WorkTag = {
  FunctionComponent: 0,
  ClassComponent: 1,
  HostRoot: 3,
  HostPortal: 4,
  HostComponent: 5,
  HostText: 6,
  ForwardRef: 11,
  MemoComponent: 14,
  SimpleMemoComponent: 15,
  /** react-dom only: <title>, <link>, ... hoisted into <head>. Not queryable; children are walked. */
  HostHoistable: 26,
  /** react-dom only: <html>, <head>, <body>. Not queryable; children are walked. */
  HostSingleton: 27,
} as const;

export interface Fiber {
  tag: number;
  type: unknown;
  key: string | null;
  memoizedProps: unknown;
  stateNode: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
}

export interface FiberRoot {
  current: Fiber;
  pendingLanes: number;
  callbackNode: unknown;
  cancelPendingCommit: unknown;
  timeoutHandle: unknown;
}

/** Object passed by a renderer to `hook.inject()`. */
export interface RendererInternals {
  bundleType?: number;
  version?: string;
  rendererPackageName?: string;
  reconcilerVersion?: string;
}

/** The subset of `__REACT_DEVTOOLS_GLOBAL_HOOK__` that renderers call. */
export interface DevToolsHook {
  supportsFiber?: boolean;
  isDisabled?: boolean;
  renderers?: Map<number, RendererInternals>;
  inject: (internals: RendererInternals) => number;
  onScheduleFiberRoot?: (rendererID: number, root: FiberRoot, children: unknown) => void;
  onCommitFiberRoot?: (rendererID: number, root: FiberRoot, priority: unknown, didError: unknown) => void;
  onPostCommitFiberRoot?: (rendererID: number, root: FiberRoot) => void;
  onCommitFiberUnmount?: (rendererID: number, fiber: Fiber) => void;
  /** react-devtools-core: the roots it has seen for a renderer. */
  getFiberRoots?: (rendererID: number) => Set<FiberRoot>;
  [key: string]: unknown;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Depth-first walk over `fiber` and its siblings (pre-order). Iterative: fiber trees can be deep. */
export function* walkSiblings(fiber: Fiber | null): Generator<Fiber> {
  const stack: Fiber[] = [];
  let node = fiber;
  while (node !== null || stack.length > 0) {
    if (node === null) node = stack.pop() ?? null;
    if (node === null) break;
    yield node;
    if (node.sibling !== null) stack.push(node.sibling);
    node = node.child;
  }
}
