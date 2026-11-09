/**
 * The only module allowed to touch React internals (requirements.md §3-3, §12).
 * Everything above it works with `HostNode` and plain strings.
 */
import { defaultPlatformDeps, loadScheduler } from './default-deps';
import type { Fiber, FiberRoot } from './fiber';
import type { HookState } from './hook';
import { installHook } from './hook';
import type { HostPlatform, PlatformDeps } from './host';
import { nativePlatform, webPlatform } from './host';
import type { SchedulerState } from './scheduler';
import { patchScheduler } from './scheduler';
import { buildHostTree, findFiberByType, findHostlessComposites } from './traverse';
import type { AdapterDiagnostics, CompositeNode, HostNode, RendererKind, Viewport } from './types';

export type { AdapterDiagnostics, CompositeNode, HandlerRef, HostNode, InstanceRef, PropsRef, RendererInfo, RendererKind, Viewport } from './types';
export { flattenStyle } from './host';

/** React Native's `noTimeout` / react-dom's `noTimeout`: no pending suspended-commit timeout. */
const NO_TIMEOUT = -1;

export interface FiberAdapterOptions {
  /** Where `__REACT_DEVTOOLS_GLOBAL_HOOK__` lives. Default: `globalThis`. */
  target?: Record<string, unknown>;
  /** Returns the `scheduler` module object. Default: `require('scheduler')`. */
  loadScheduler?: () => unknown;
  platformDeps?: PlatformDeps;
  now?: () => number;
}

/**
 * Install the DevTools hook and patch the scheduler on `target`, before any renderer loads. Run by
 * `src/early.ts`, which `withQuiesco()` makes Metro execute ahead of React Native's own setup.
 * Idempotent: FiberAdapter.install() later picks up the same hook and scheduler state.
 */
export function installEarly(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>, load: () => unknown = loadScheduler): void {
  installHook(target);
  try {
    patchScheduler(load());
  } catch {
    // FiberAdapter.install() reports scheduler problems.
  }
}

export class FiberAdapter {
  private hook: HookState | null = null;
  private scheduler: SchedulerState | null = null;
  private schedulerError: string | null = null;
  private scopeType: unknown = null;
  private readonly platforms = new Map<RendererKind, HostPlatform>();
  private readonly now: () => number;

  constructor(private readonly options: FiberAdapterOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Install the DevTools hook and patch the scheduler. Must run before the renderer module loads,
   * i.e. from the first import of the app entry (docs/spikes/01 §1, 02 §2). Idempotent.
   */
  install(): void {
    if (this.hook !== null) return;
    this.hook = installHook(this.options.target ?? (globalThis as unknown as Record<string, unknown>));
    try {
      this.scheduler = patchScheduler((this.options.loadScheduler ?? loadScheduler)(), this.now);
      if (!this.scheduler.patched) this.schedulerError = 'scheduler module has no unstable_scheduleCallback';
    } catch (e) {
      this.schedulerError = `cannot load scheduler: ${String(e)}`;
    }
  }

  /**
   * Restrict queries to the subtree of the first fiber whose component type is `componentType`
   * (e.g. `QuiescoRoot`), excluding dev-client overlays (docs/spikes/01 §2). `null` = whole app.
   */
  setScope(componentType: unknown): void {
    this.scopeType = componentType;
  }

  /** Top-level host nodes within the scope, across all roots. Built fresh on every call. */
  getHostRoots(): HostNode[] {
    const out: HostNode[] = [];
    const hook = this.requireHook();
    for (const [rendererID, roots] of hook.roots) {
      const platform = this.platformFor(rendererID);
      for (const root of roots) {
        let start = root.current;
        if (this.scopeType !== null) {
          const scoped = findFiberByType(start, this.scopeType);
          if (scoped === null) continue;
          start = scoped;
        }
        out.push(...buildHostTree(start, platform));
      }
    }
    return out;
  }

  /**
   * Components within the scope that render no host element and satisfy `test` (value actions on e.g.
   * Android's DateTimePicker, which renders null and opens a system dialog).
   */
  findHostlessComposites(test: (c: CompositeNode) => boolean): CompositeNode[] {
    const out: CompositeNode[] = [];
    for (const start of this.scopedStarts()) out.push(...findHostlessComposites(start, test));
    return out;
  }

  /** Window size of the (first) renderer in use, in the same units as `HostNode.measure()`. */
  viewport(): Viewport | null {
    const first = this.requireHook().roots.keys().next();
    return first.done === true ? null : this.platformFor(first.value).viewport();
  }

  /** Detector A (docs/spikes/02): pending work recorded on FiberRoot fields. Empty = idle. */
  pendingRootWork(): string[] {
    const busy: string[] = [];
    for (const root of this.allRoots()) {
      if (root.pendingLanes !== 0) busy.push(`pendingLanes=0b${root.pendingLanes.toString(2)}`);
      if (root.callbackNode != null) busy.push('callbackNode');
      if (root.cancelPendingCommit != null) busy.push('cancelPendingCommit');
      if (root.timeoutHandle !== NO_TIMEOUT && root.timeoutHandle !== undefined) busy.push(`timeoutHandle=${String(root.timeoutHandle)}`);
    }
    return busy;
  }

  /** Detector B (docs/spikes/02): scheduler tasks not yet finished. Empty = idle. */
  pendingSchedulerTasks(): string[] {
    const out: string[] = [];
    if (this.scheduler === null) return out;
    const t = this.now();
    for (const task of this.scheduler.pending.values()) {
      out.push(`task#${task.id} p${task.priority} ${t - task.since}ms${task.continued > 0 ? ` (continued ×${task.continued})` : ''}`);
    }
    return out;
  }

  /** Called after every commit of any root. Returns an unsubscribe function. */
  onCommit(listener: () => void): () => void {
    const hook = this.requireHook();
    const l = (): void => listener();
    hook.commitListeners.add(l);
    return () => hook.commitListeners.delete(l);
  }

  diagnostics(): AdapterDiagnostics {
    const hook = this.hook;
    const problems: string[] = [];
    const warnings: string[] = [];
    if (hook === null) {
      problems.push('fiber adapter not installed');
      return { hookSource: 'none', schedulerPatched: false, renderers: [], rootCount: 0, problems, warnings };
    }
    const renderers = [...hook.renderers.values()];
    if (hook.lateRenderers.length > 0) {
      problems.push(
        `The app rendered before @quiesco/agent was installed (${hook.lateRenderers.map((r) => r.packageName).join(', ')}); ` +
          'work started before that is not tracked. Import @quiesco/agent on the first line of the app entry file.',
      );
    }
    if (this.schedulerError !== null) problems.push(this.schedulerError);
    for (const r of renderers) {
      if (!r.supported) warnings.push(`untested renderer ${r.packageName}@${r.version}; queries may not work`);
    }
    return {
      hookSource: hook.source,
      schedulerPatched: this.scheduler?.patched ?? false,
      renderers,
      rootCount: this.allRoots().length,
      problems,
      warnings,
    };
  }

  /**
   * Call once the app has rendered (e.g. when QuiescoRoot mounts). If no renderer was injected by
   * then, the renderer loaded before the hook existed and never saw it.
   */
  checkRendererSeen(): string | null {
    const hook = this.requireHook();
    if (hook.renderers.size > 0) return null;
    return (
      'No React renderer registered with the Quiesco DevTools hook: the renderer loaded before the hook existed. ' +
      'Wrap metro.config.js with withQuiesco() from @quiesco/agent/metro (it runs the hook before React Native ' +
      'starts) and import @quiesco/agent on the first line of the app entry file.'
    );
  }

  private scopedStarts(): Fiber[] {
    const out: Fiber[] = [];
    for (const roots of this.requireHook().roots.values()) {
      for (const root of roots) {
        const start = this.scopeType === null ? root.current : findFiberByType(root.current, this.scopeType);
        if (start !== null) out.push(start);
      }
    }
    return out;
  }

  private allRoots(): FiberRoot[] {
    const out: FiberRoot[] = [];
    for (const set of this.requireHook().roots.values()) out.push(...set);
    return out;
  }

  private platformFor(rendererID: number): HostPlatform {
    const kind = this.hook?.renderers.get(rendererID)?.kind ?? 'native';
    let p = this.platforms.get(kind);
    if (p === undefined) {
      const deps = this.options.platformDeps ?? defaultPlatformDeps;
      p = kind === 'web' ? webPlatform(deps) : nativePlatform(deps);
      this.platforms.set(kind, p);
    }
    return p;
  }

  private requireHook(): HookState {
    if (this.hook === null) throw new Error('FiberAdapter.install() has not been called');
    return this.hook;
  }
}
