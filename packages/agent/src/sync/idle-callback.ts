/**
 * Pending idle-callback tracker (requirements.md §6.2-4, tracker name `idle-callback`):
 * - `requestIdleCallback` callbacks not yet run (RN 0.88 removed InteractionManager and recommends it).
 * - On older React Native versions that still have `InteractionManager`, its open interaction
 *   handles and not-yet-run `runAfterInteractions` tasks.
 */
import type { IdleTracker } from './tracker';
import { isFunction, patch } from './tracker';

type RicFn = (this: unknown, cb: unknown, options?: unknown) => unknown;
type CancelFn = (this: unknown, id: unknown) => void;

export interface IdleCallbackGlobals {
  requestIdleCallback?: RicFn;
  cancelIdleCallback?: CancelFn;
}

/** The parts of the legacy `InteractionManager` API that are tracked. */
export interface InteractionManagerLike {
  createInteractionHandle: (this: unknown) => unknown;
  clearInteractionHandle: (this: unknown, handle: unknown) => void;
  runAfterInteractions: (this: unknown, task?: unknown) => { then?: unknown; cancel?: unknown } | undefined;
}

export interface IdleCallbackTrackerOptions {
  target?: IdleCallbackGlobals;
  /** Pass React Native's `InteractionManager` when it exists (RN < 0.88). */
  interactionManager?: InteractionManagerLike | null;
  now?: () => number;
}

export class IdleCallbackTracker implements IdleTracker {
  readonly name = 'idle-callback';
  private readonly callbacks = new Map<unknown, { since: number; name: string }>();
  private readonly handles = new Set<unknown>();
  private readonly tasks = new Map<number, number>();
  private readonly restores: (() => void)[] = [];
  private readonly target: IdleCallbackGlobals;
  private readonly now: () => number;
  private nextTask = 1;
  private readonly attached = new Set<InteractionManagerLike>();

  constructor(private readonly options: IdleCallbackTrackerOptions = {}) {
    this.target = options.target ?? (globalThis as unknown as IdleCallbackGlobals);
    this.now = options.now ?? Date.now;
  }

  isIdle(): boolean {
    return this.callbacks.size === 0 && this.handles.size === 0 && this.tasks.size === 0;
  }

  describeBusy(): string[] {
    const t = this.now();
    const out = [...this.callbacks.values()].map((c) => `requestIdleCallback(${c.name}) ${t - c.since}ms`);
    if (this.handles.size > 0) out.push(`InteractionManager: ${this.handles.size} open interaction handle(s)`);
    for (const since of this.tasks.values()) out.push(`InteractionManager.runAfterInteractions task ${t - since}ms`);
    return out;
  }

  install(): void {
    if (this.restores.length > 0) return;
    const self = this;
    const g = this.target;
    if (isFunction(g.requestIdleCallback) && isFunction(g.cancelIdleCallback)) {
      const tg = g as Required<IdleCallbackGlobals>;
      this.restores.push(
        patch(tg, 'requestIdleCallback', (original) =>
          function (this: unknown, cb: unknown, options?: unknown) {
            if (!isFunction(cb)) return original.call(this, cb, options);
              const wrapped = function (this: unknown, ...a: unknown[]) {
              self.callbacks.delete(id);
              return (cb as (...x: unknown[]) => unknown).apply(this, a);
            };
            const id: unknown = original.call(this, wrapped, options);
            self.callbacks.set(id, { since: self.now(), name: cb.name || 'anonymous' });
            return id;
          },
        ),
        patch(tg, 'cancelIdleCallback', (original) =>
          function (this: unknown, id: unknown) {
            self.callbacks.delete(id);
            return original.call(this, id);
          },
        ),
      );
    }
    if (this.options.interactionManager != null) this.attachInteractionManager(this.options.interactionManager);
  }

  /**
   * Track a legacy InteractionManager. Separate from install() so the runtime can look it up after the
   * app has started (requiring react-native at agent import time would be too early).
   */
  attachInteractionManager(im: InteractionManagerLike): void {
    if (this.attached.has(im)) return;
    this.attached.add(im);
    const self = this;
    this.restores.push(
      patch(im, 'createInteractionHandle', (original) =>
        function (this: unknown) {
          const h = original.call(this);
          self.handles.add(h);
          return h;
        },
      ),
      patch(im, 'clearInteractionHandle', (original) =>
        function (this: unknown, h: unknown) {
          self.handles.delete(h);
          return original.call(this, h);
        },
      ),
      patch(im, 'runAfterInteractions', (original) =>
        function (this: unknown, task?: unknown) {
          const result = original.call(this, task);
          const id = self.nextTask++;
          self.tasks.set(id, self.now());
          const done = (): void => {
            self.tasks.delete(id);
          };
          if (result != null && isFunction(result.then)) (result.then as (a: () => void, b: () => void) => unknown).call(result, done, done);
          else done();
          if (result != null && isFunction(result.cancel)) {
            const cancel = result.cancel;
            result.cancel = function (this: unknown, ...a: never[]) {
              done();
              return cancel.apply(this, a);
            };
          }
          return result;
        },
      ),
    );
  }

  uninstall(): void {
    while (this.restores.length > 0) this.restores.pop()?.();
    this.attached.clear();
    this.callbacks.clear();
    this.handles.clear();
    this.tasks.clear();
  }
}
