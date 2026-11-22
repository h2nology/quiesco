/**
 * Native module tracker (tracker name `native-module`, issue #67): a promise returned by a native module
 * method (a TurboModule, a legacy NativeModule, an Expo module) that has not settled yet, or a call given
 * callbacks that has not called any of them yet (issue #107: AsyncStorage 2's `setItem` calls
 * `multiSet(pairs, callback)`), e.g. `await AsyncStorage.setItem(…)` between a request and a navigation. On when the build wraps native
 * modules (issue #94), unless the config turns it off (`sync.trackers: { 'native-module': false }`).
 *
 * The modules are wrapped where the app gets them: React Native's `TurboModuleRegistry.get` /
 * `getEnforcing` (which fall back to `NativeModules`) and Expo's `globalThis.expo.modules`. Modules taken
 * before the agent loaded (React Native's own, during its startup) are not wrapped. The wrapping is
 * installed at app start, before the host's config says whether the tracker is on (the modules are taken
 * when the app's modules load). While it is off, calls are still recorded but never count: an action can
 * say which calls were pending when it returned (`notCounted`, issue #94).
 *
 * The wrapping is installed only when the build asks for it (`wrap`, from `withQuiesco(config, {
 * nativeModules: true })`, issue #74): a wrapped method is a JS function, not the native host function,
 * and libraries that take a module's methods and call them from worklets on the UI runtime (Gesture
 * Handler 3) crash with it. Without it the tracker never counts anything.
 *
 * Some native calls wait for the user (a permission request, an authentication sheet, a picker) and stay
 * pending until the test answers them: a call counts as busy for at most `thresholdMs` (default 2 s), and
 * calls matching `ignore` ("Module.method"; strings match as substrings) never count. Well-known ones are
 * ignored by default (DEFAULT_IGNORED_NATIVE_CALLS, issue #93), unless `defaultIgnore: false`.
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
  /** Install the wrapping at all (the build asked for it, issue #74). Default true. */
  wrap?: boolean;
}

/** How long a pending native call counts as busy by default. */
export const NATIVE_CALL_THRESHOLD_MS = 2_000;

/**
 * Calls that wait for the user (issue #93): a permission request, a picker, an authentication or share
 * sheet. They settle when the test answers the system UI, so counting them only adds `thresholdMs` to the
 * action that opens it.
 */
export const DEFAULT_IGNORED_NATIVE_CALLS: readonly RegExp[] = [
  // Expo modules (ExpoLocation.requestForegroundPermissionsAsync, ExpoCamera.requestCameraPermissionsAsync,
  // ExpoNotificationPermissionsModule.requestPermissionsAsync, …) and PermissionsAndroid.requestPermission /
  // requestMultiplePermissions.
  /\.request\w*Permissions?(?:Async)?$/,
  // @react-native-community/datetimepicker on Android (a dialog).
  /^RNC(?:Date|Time)Picker\.open$/,
  /^ExpoLocalAuthentication\.authenticateAsync$/,
  /^ShareModule\.share$/,
  /^ExpoSharing\.shareAsync$/,
  /^ExpoWebBrowser\.(?:openBrowserAsync|openAuthSessionAsync)$/,
  /^ExponentImagePicker\.launch(?:Camera|ImageLibrary)Async$/,
  /^ExpoDocumentPicker\.getDocumentAsync$/,
  // Callback style (issue #107): an alert or action sheet calls back when the user answers it.
  /^AlertManager\.alertWithArgs$/,
  /^DialogManagerAndroid\.showAlert$/,
  /^ActionSheetManager\.show\w*ActionSheetWithOptions$/,
  // A native-driver animation calls its end callback when the animation ends (a loop: never).
  /^NativeAnimated(?:Turbo)?Module\./,
];

/** Pending calls kept while off: a call that never settles must not grow the map without end. */
const MAX_PENDING = 500;
/** Recent calls kept for the record of how a wait ended (issue #107). */
const MAX_RECENT = 50;
/** Calls listed in that record, at most (the latest). */
const MAX_ACTIVITY = 10;

interface Pending {
  name: string;
  since: number;
}

interface Recent extends Pending {
  /** When it settled (ms since the epoch); undefined while pending. */
  settled?: number;
}

export class NativeModuleTracker implements IdleTracker {
  readonly name = 'native-module';
  private readonly clock: Clock;
  private readonly pending = new Map<number, Pending>();
  private readonly recent: Recent[] = [];
  private nextId = 0;
  private enabled = false;
  private thresholdMs = NATIVE_CALL_THRESHOLD_MS;
  private ignore: readonly (RegExp | string)[] = DEFAULT_IGNORED_NATIVE_CALLS;
  private readonly wrapped = new WeakMap<object, object>();
  private undo: (() => void)[] = [];
  private readonly skip: ReadonlySet<string>;

  constructor(private readonly options: NativeModuleTrackerOptions) {
    this.clock = options.clock ?? realClock;
    this.skip = new Set(options.skip ?? []);
  }

  /**
   * Whether calls count (the tracker is enabled), and its settings. `ignore` adds to the default list
   * unless `defaultIgnore` is false.
   */
  configure(opts: { enabled: boolean; thresholdMs?: number; ignore?: readonly (RegExp | string)[]; defaultIgnore?: boolean }): void {
    this.enabled = opts.enabled;
    this.thresholdMs = opts.thresholdMs ?? NATIVE_CALL_THRESHOLD_MS;
    this.ignore = [...(opts.defaultIgnore === false ? [] : DEFAULT_IGNORED_NATIVE_CALLS), ...(opts.ignore ?? [])];
  }

  /** The pending calls that count (or would, while the tracker is off). */
  private wouldCount(): Pending[] {
    const now = this.clock.now();
    return [...this.pending.values()].filter((p) => now - p.since < this.thresholdMs && !this.ignored(p.name));
  }

  private ignored(name: string): boolean {
    return this.ignore.some((r) => (typeof r === 'string' ? name.includes(r) : ((r.lastIndex = 0), r.test(name))));
  }

  private counting(): Pending[] {
    return this.enabled ? this.wouldCount() : [];
  }

  /**
   * While the tracker is off: the calls it would count now (issue #94: an action that returns while the
   * app awaits one may race the test). Empty while it is on (they count) or when nothing is wrapped.
   */
  notCounted(): string[] {
    if (this.enabled) return [];
    const now = this.clock.now();
    return this.wouldCount().map((p) => `${p.name}() ${now - p.since}ms`);
  }

  isIdle(): boolean {
    return this.counting().length === 0;
  }

  /**
   * The calls pending at some point between `from` and `to` (issue #107), times relative to `from`:
   * `RNCAsyncStorage.multiSet() +251ms→+266ms`, `… +251ms→pending`. Ignored calls, and all calls while the
   * tracker is off, are marked: they did not count.
   */
  describeActivity(from: number, to: number): string[] {
    const rel = (t: number): string => `${t < from ? '-' : '+'}${Math.abs(t - from)}ms`;
    return this.recent
      .filter((c) => c.since <= to && (c.settled === undefined || c.settled >= from))
      .slice(-MAX_ACTIVITY)
      .map((c) => {
        const end = c.settled === undefined || c.settled > to ? 'pending' : rel(c.settled);
        const note = !this.enabled ? ' (not counted: tracker off)' : this.ignored(c.name) ? ' (ignored)' : '';
        return `${c.name}() ${rel(c.since)}→${end}${note}`;
      });
  }

  describeBusy(): string[] {
    const now = this.clock.now();
    return this.counting().map((p) => `${p.name}() ${now - p.since}ms`);
  }

  /** Whether this build wraps native modules (without it the tracker cannot count anything). */
  get wraps(): boolean {
    return this.options.wrap !== false;
  }

  install(): void {
    if (!this.wraps || this.undo.length > 0) return;
    this.installRegistry();
    this.installExpo();
  }

  uninstall(): void {
    for (const u of this.undo.splice(0).reverse()) u();
    this.pending.clear();
    this.recent.length = 0;
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
        const self = this;
        const wrapper = function (this: unknown, ...args: unknown[]): unknown {
          // Callback style (AsyncStorage 2's `multiSet(pairs, callback)`, issue #107): pending until the
          // first of its callbacks is called. A call that returns a promise is pending until it settles.
          const callback = args.some((a) => typeof a === 'function') ? self.begin(name) : null;
          const callArgs = callback === null ? args : args.map((a) => (typeof a === 'function' ? settling(a as (...x: unknown[]) => unknown, callback.done) : a));
          let result: unknown;
          try {
            result = method.apply(this === proxy || this === undefined ? target : this, callArgs);
          } catch (e) {
            callback?.done();
            throw e;
          }
          if (isThenable(result)) {
            callback?.done();
            self.track(name, result);
          }
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
    const { done } = this.begin(name);
    try {
      result.then(done, done);
    } catch {
      done();
    }
  }

  /** A call pending from now until `done()` (idempotent). */
  private begin(name: string): { done: () => void } {
    const id = this.nextId++;
    if (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value as number);
    const call: Recent = { name, since: this.clock.now() };
    this.pending.set(id, call);
    this.recent.push(call);
    if (this.recent.length > MAX_RECENT) this.recent.shift();
    return {
      done: () => {
        if (!this.pending.delete(id)) return;
        call.settled = this.clock.now();
      },
    };
  }
}

/** `fn`, ending the call before it runs (the app's code after the callback then sees the call settled). */
function settling(fn: (...args: unknown[]) => unknown, done: () => void): (...args: unknown[]) => unknown {
  return function (this: unknown, ...args: unknown[]): unknown {
    done();
    return fn.apply(this, args);
  };
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
