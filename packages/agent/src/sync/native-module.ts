/**
 * Native module tracker (tracker name `native-module`, issue #67): a promise returned by a native module
 * method (a TurboModule, a legacy NativeModule, an Expo module) that has not settled yet, e.g.
 * `await AsyncStorage.setItem(…)` between a request and a navigation. Off unless enabled
 * (`sync.trackers: { 'native-module': true }`).
 *
 * The modules are wrapped where the app gets them: React Native's `TurboModuleRegistry.get` /
 * `getEnforcing` (which fall back to `NativeModules`) and Expo's `globalThis.expo.modules`. Modules taken
 * before the agent loaded (React Native's own, during its startup) are not wrapped. The wrapping is
 * installed at app start, before the host's config says whether the tracker is on (the modules are taken
 * when the app's modules load); while it is off a wrapped call only passes through.
 *
 * Some native calls wait for the user (a permission request, an authentication sheet, a picker) and stay
 * pending until the test answers them: a call counts as busy for at most `thresholdMs` (default 2 s), and
 * calls matching `ignore` ("Module.method"; strings match as substrings) never count.
 */
import type { Clock, IdleTracker } from './tracker';
import { realClock } from './tracker';

/** `TurboModuleRegistry` as React Native exports it (its functions are replaced in place). */
export interface ModuleRegistryLike {
  get?(name: string): unknown;
  getEnforcing?(name: string): unknown;
}

export interface NativeModuleSources {
  /** React Native's TurboModuleRegistry, or null (the web). */
  registry(): ModuleRegistryLike | null;
  /** The object holding Expo's `modules` (`globalThis.expo`), or null. */
  expo(): { modules?: Record<string, unknown> } | null;
}

export interface NativeModuleTrackerOptions {
  sources: NativeModuleSources;
  clock?: Clock;
  /** Modules never wrapped (the agent's own). */
  skip?: readonly string[];
}

/** How long a pending native call counts as busy by default. */
export const NATIVE_CALL_THRESHOLD_MS = 2_000;

interface Pending {
  name: string;
  since: number;
}

export class NativeModuleTracker implements IdleTracker {
  readonly name = 'native-module';
  private readonly clock: Clock;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private enabled = false;
  private thresholdMs = NATIVE_CALL_THRESHOLD_MS;
  private ignore: readonly (RegExp | string)[] = [];
  private readonly wrapped = new WeakMap<object, object>();
  private undo: (() => void)[] = [];
  private readonly skip: ReadonlySet<string>;

  constructor(private readonly options: NativeModuleTrackerOptions) {
    this.clock = options.clock ?? realClock;
    this.skip = new Set(options.skip ?? []);
  }

  /** Whether calls are recorded (the tracker is enabled in the config), and its settings. */
  configure(opts: { enabled: boolean; thresholdMs?: number; ignore?: readonly (RegExp | string)[] }): void {
    this.enabled = opts.enabled;
    this.thresholdMs = opts.thresholdMs ?? NATIVE_CALL_THRESHOLD_MS;
    this.ignore = opts.ignore ?? [];
    if (!this.enabled) this.pending.clear();
  }

  private counting(): Pending[] {
    const now = this.clock.now();
    return [...this.pending.values()].filter((p) => now - p.since < this.thresholdMs && !this.ignore.some((r) => (typeof r === 'string' ? p.name.includes(r) : (r.lastIndex = 0, r.test(p.name)))));
  }

  isIdle(): boolean {
    return this.counting().length === 0;
  }

  describeBusy(): string[] {
    const now = this.clock.now();
    return this.counting().map((p) => `${p.name}() ${now - p.since}ms`);
  }

  install(): void {
    if (this.undo.length > 0) return;
    this.installRegistry();
    this.installExpo();
  }

  uninstall(): void {
    for (const u of this.undo.splice(0).reverse()) u();
    this.pending.clear();
  }

  private installRegistry(): void {
    const registry = safe(() => this.options.sources.registry(), null);
    if (registry === null) return;
    for (const key of ['get', 'getEnforcing'] as const) {
      const original = registry[key];
      if (typeof original !== 'function') continue;
      const replacement = (name: string): unknown => this.wrapModule(name, original.call(registry, name));
      if (!assign(registry, key, replacement)) continue;
      this.undo.push(() => {
        if (registry[key] === replacement) assign(registry, key, original);
      });
    }
  }

  private installExpo(): void {
    const holder = safe(() => this.options.sources.expo(), null);
    const modules = holder?.modules;
    if (holder === null || typeof modules !== 'object' || modules === null) return;
    const proxy = new Proxy(modules, {
      get: (target, key, receiver) => {
        const value: unknown = Reflect.get(target, key, receiver);
        return typeof key === 'string' ? this.wrapModule(key, value) : value;
      },
    });
    if (!assign(holder, 'modules', proxy)) return;
    this.undo.push(() => {
      if (holder.modules === proxy) assign(holder, 'modules', modules);
    });
  }

  /** The module with its methods recording the promises they return (same proxy for the same module). */
  private wrapModule(moduleName: string, module: unknown): unknown {
    if ((typeof module !== 'object' && typeof module !== 'function') || module === null || this.skip.has(moduleName)) return module;
    const known = this.wrapped.get(module);
    if (known !== undefined) return known;
    const methods = new Map<PropertyKey, { original: unknown; wrapper: unknown }>();
    const proxy = new Proxy(module, {
      get: (target, key) => {
        // Host objects (JSI) need themselves as the receiver.
        const value: unknown = Reflect.get(target, key);
        if (typeof value !== 'function' || typeof key !== 'string') return value;
        const cached = methods.get(key);
        if (cached !== undefined && cached.original === value) return cached.wrapper;
        const method = value as (...args: unknown[]) => unknown;
        const name = `${moduleName}.${key}`;
        const record = (result: unknown): void => {
          if (this.enabled && isThenable(result)) this.track(name, result);
        };
        const wrapper = function (this: unknown, ...args: unknown[]): unknown {
          const result = method.apply(this === proxy || this === undefined ? target : this, args);
          record(result);
          return result;
        };
        methods.set(key, { original: value, wrapper });
        return wrapper;
      },
    });
    this.wrapped.set(module, proxy);
    return proxy;
  }

  private track(name: string, result: PromiseLike<unknown>): void {
    const id = this.nextId++;
    this.pending.set(id, { name, since: this.clock.now() });
    const done = () => void this.pending.delete(id);
    try {
      result.then(done, done);
    } catch {
      done();
    }
  }
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as { then?: unknown }).then === 'function';
}

/** Set `obj[key]`, also when it is a read-only data property that can be redefined; false when it cannot. */
function assign(obj: object, key: string, value: unknown): boolean {
  try {
    (obj as Record<string, unknown>)[key] = value;
    if ((obj as Record<string, unknown>)[key] === value) return true;
  } catch {
    // Read-only: try to redefine it.
  }
  try {
    Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable: true });
    return (obj as Record<string, unknown>)[key] === value;
  } catch {
    return false;
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
