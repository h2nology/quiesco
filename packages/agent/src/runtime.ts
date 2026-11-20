/**
 * The agent runtime: owns the fiber adapter, the trackers, the connection and the request handlers.
 * One instance per JS context, created when `@quiesco/agent` is first imported (it must be the first
 * import of the app entry, so the DevTools hook and scheduler patch precede the renderer).
 */
import { SyncDefaults, WEBVIEW_HOOK } from '@quiesco/protocol';
import type { Direction, Edge, ErrorDataMap, LogBoxMode, Point, Speed, StepTiming } from '@quiesco/protocol';
import type {
  ActionSpec,
  ActionType,
  HostInput,
  AgentConfig,
  AgentMethods,
  AssertionSpec,
  ElementSummary,
  JsonValue,
  Matcher,
  ParamsOf,
  Rect,
  ResultOf,
  SyncOption,
} from '@quiesco/protocol';

import * as js from './actions/js';
import { fromNativeError, nativePerformer } from './actions/native';
import { NativeSettleTracker } from './sync/native-settle';
import type { NativeBridge } from './actions/native';
import { hostPerformer } from './actions/host';
import { jsPerformer } from './actions/performer';
import type { ActionPerformer } from './actions/performer';
import * as value from './actions/value';
import type { StorageAdapter } from './api-types';
import { assertionMessage, evaluate } from './assertions';
import { BackdoorRegistry } from './backdoor';
import { buildConfig } from './build-config';
import { AgentClient, MethodNotFound } from './connection/client';
import { decodeLaunchArgs, resolveParams } from './connection/params';
import { QuiescoError } from './errors';
import { EventForwarder } from './events';
import { FiberAdapter } from './fiber-adapter';
import type { CompositeNode, FiberAdapterOptions, HostNode } from './fiber-adapter';
import type { AppDeps } from './platform';
import { defaultAppDeps } from './platform';
import { NavigationReset } from './navigation';
import { ResetManager } from './reset';
import { appLogBox } from './reset/logbox';
import type { LogBoxLike } from './reset/logbox';
import { defaultStorageAdapters } from './reset/storage-defaults';
import { describeMatcher, findAll, getTree, invisibleReason, isCenterVisible, isVisible, listElements, sizedAncestor, structureLines, summarize, toRegExp } from './query';
import type { Clock, FetchFn, IdleTracker, TimerGlobals } from './sync';
import { FrameStableTracker, IdleCallbackTracker, NativeModuleTracker, NetworkTracker, OfflineGate, ReactTracker, SyncEngine, TimerTracker, ownConnection, realClock } from './sync';
import { AGENT_VERSION } from './version';

/** How long a coordinate calibration is trusted while the window keeps its size (calibrateCoordinates). */
const CALIBRATION_INTERVAL_MS = 1000;
/** drag: hold before moving (long enough to start long-press-activated drags), and move duration. */
const DRAG_HOLD_MS = 800;
/**
 * A sync wait shorter than this (or a quarter of the call's timeout, if less) says nothing about the app:
 * frame-stable has not sampled its frames yet.
 */
const MIN_BUSY_REPORT_MS = 250;
const DRAG_MS: Record<Speed, number> = { slow: 1200, normal: 600, fast: 250 };
const LONG_PRESS_AT_MS = 800;
/** scrollToEdge: at most this many steps; each waits for idle (up to the call timeout), so virtualized lists can grow. */
const MAX_EDGE_STEPS = 60;
/** Finger direction of a fling towards an edge (to reach the bottom, the finger moves up). */
const EDGE_FINGER: Record<Edge, Direction> = { top: 'down', bottom: 'up', left: 'right', right: 'left' };
/** The end a scroll in a direction (content moving that way into view) runs into. */
const EDGE_OF: Record<Direction, Edge> = { down: 'bottom', up: 'top', right: 'right', left: 'left' };
/**
 * In the background no frames are drawn and Android pauses React Native's timers, so these trackers
 * would never settle (Phase 6.5 spike); they count as idle until the app is active again.
 */
const BACKGROUND_SKIPPED: ReadonlySet<string> = new Set(['frame-stable', 'timer', 'native']);
const NONE: ReadonlySet<string> = new Set();
/**
 * Native modules the `native-module` tracker never wraps: the agent's own, and modules whose methods are
 * called from worklets on the UI runtime and must stay native host functions (issue #74).
 */
const NATIVE_MODULES_NOT_TRACKED = ['QuiescoNative', 'RNGestureHandlerModule', 'ReanimatedModule', 'WorkletsModule'];

/** The `native-module` tracker is on, but the build does not wrap native modules (issue #74). */
export const NATIVE_MODULES_NOT_WRAPPED =
  "The native-module tracker is on, but this build does not wrap native modules, so it counts nothing. Build the app with withQuiesco(config, { nativeModules: true }) in metro.config.js (or EXPO_PUBLIC_QUIESCO_NATIVE_MODULES=1) to track native module calls.";

/** Trackers that count only when the config enables them (`sync.trackers: { 'native-module': true }`, issue #67). */
const TRACKERS_OFF_BY_DEFAULT: Readonly<Record<string, false>> = { 'native-module': false };
/** Calls whose results report the time spent waiting for idle (`syncMs`, Phase 6.9 timeline). */
const TIMED: ReadonlySet<string> = new Set(['query', 'action', 'assert', 'webview', 'scrollView']);

export interface RuntimeOptions {
  adapter?: FiberAdapterOptions;
  deps?: AppDeps;
  clock?: Clock;
  globalObject?: Record<string, unknown>;
  /** Trackers to use instead of the default set (tests). */
  trackers?: (runtime: AgentRuntime) => IdleTracker[];
  /** Wrap native modules for the `native-module` tracker (default: the build config's `nativeModules`, issue #74). */
  nativeModules?: boolean;
  /** Built-in storage adapters (default: AsyncStorage on native, web storage on web). */
  storage?: () => StorageAdapter[];
  /** React Native's LogBox (default: from react-native on iOS / Android, none on the web). */
  logBox?: () => LogBoxLike | null;
}

type Handlers = { [M in keyof AgentMethods]: (params: ParamsOf<AgentMethods[M]>) => Promise<ResultOf<AgentMethods[M]>> };

/**
 * scrollTo: each step scrolls by this fraction of the scroll view, less than one view so no target is
 * skipped (a step is a drag that ends without a fling, issue #46).
 */
const SCROLL_TO_STEP = 0.85;
/**
 * scrollTo: at most this many steps in both directions together (issue #63). Each step waits for idle
 * up to the call timeout, like scrollToEdge; the host allows for it (MAX_SCROLL_STEPS in core's driver).
 */
const MAX_SCROLL_TO_STEPS = 60;

export class AgentRuntime {
  readonly adapter: FiberAdapter;
  readonly engine: SyncEngine;
  readonly events: EventForwarder;
  readonly backdoors = new BackdoorRegistry();
  readonly resets: ResetManager;
  /** Expo Router's navigation state across soft resets (issue #1). */
  readonly navigation = new NavigationReset();
  client: AgentClient | null = null;
  config: AgentConfig = {
    sync: {
      timeoutMs: SyncDefaults.timeoutMs,
      timerThresholdMs: SyncDefaults.timerThresholdMs,
      countIntervals: SyncDefaults.countIntervals,
      stableFrames: SyncDefaults.stableFrames,
      ignoreUrls: [],
      trackers: {},
    },
    logLevel: 'warn',
  };
  private readonly deps: AppDeps;
  /** Whether the host has sent its config (hello / configure). */
  private configured = false;
  /** `app.device.setNetwork('offline')` (Phase 6.6). */
  private readonly offline: OfflineGate;
  private readonly clock: Clock;
  private readonly global: Record<string, unknown>;
  private network: NetworkTracker | null = null;
  private nativeCalls: NativeModuleTracker | null = null;
  private readonly nativeModulesWrapped: boolean;
  private nativeModulesWarned = false;
  private timer: TimerTracker | null = null;
  private frames: FrameStableTracker | null = null;
  private idleCallbacks: IdleCallbackTracker | null = null;
  private mounted = 0;
  private remount: (() => void) | null = null;
  private native: ReturnType<AppDeps['nativeModule']> | undefined;
  private launchArgsCache: Record<string, JsonValue> | null = null;
  /** Pending stop after the last QuiescoRoot unmounted (see unmount). */
  private stopTimer: unknown = null;
  /** WebViews (by view tag) whose later page loads already run WEBVIEW_HOOK at document start. */
  private readonly hookedWebViews = new Set<number>();
  /** Original console methods, captured before the event forwarder wraps them. */
  private readonly log: (message: string) => void;
  private readonly logBox: () => LogBoxLike | null;
  /** This runtime turned LogBox notifications off (`appErrors.logBox: 'ignore'`). */
  private logBoxIgnored = false;

  constructor(options: RuntimeOptions = {}) {
    this.global = options.globalObject ?? (globalThis as unknown as Record<string, unknown>);
    this.deps = options.deps ?? defaultAppDeps;
    this.clock = options.clock ?? realClock;
    this.adapter = new FiberAdapter({ target: this.global, ...options.adapter });
    this.offline = new OfflineGate(this.global);
    const c = this.global['console'] as { warn?: (...a: unknown[]) => void } | undefined;
    const warn = c?.warn;
    this.log = (m) => warn?.call(c, `[quiesco] ${m}`);
    this.nativeModulesWrapped = options.nativeModules ?? buildConfig.nativeModules === true;
    this.engine = new SyncEngine(options.trackers?.(this) ?? this.defaultTrackers(), this.clock);
    this.engine.setEnabled(TRACKERS_OFF_BY_DEFAULT);
    this.engine.setSkipped(() => (this.deps.appState() === 'background' ? BACKGROUND_SKIPPED : NONE));
    this.engine.setBackground(() => this.deps.appState() === 'background', this.deps.onAppStateChange?.bind(this.deps));
    this.resets = new ResetManager(options.storage ?? (() => defaultStorageAdapters()));
    this.logBox = options.logBox ?? appLogBox;
    this.events = new EventForwarder({ notify: (e, p) => this.client?.notify(e, p), target: this.global });
  }

  /** Called at import time: everything that must precede the renderer and the app's first effects. */
  installEarly(): void {
    this.adapter.install();
    // Before the network tracker, which then wraps it (and reports the URLs the app asked for).
    this.offline.install();
    this.engine.install();
    this.events.install();
  }

  /** QuiescoRoot mounted: restrict queries to its subtree, report setup problems, connect. */
  mount(scopeComponent: unknown): void {
    this.mounted++;
    if (this.stopTimer !== null) {
      // Remounted in the same commit (see unmount): keep the connection.
      this.clock.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    this.adapter.setScope(scopeComponent);
    const problems = [...this.adapter.diagnostics().problems];
    const late = this.adapter.checkRendererSeen();
    if (late !== null) problems.push(late);
    for (const p of problems) this.log(p);
    const im = this.deps.interactionManager();
    if (im !== null) this.idleCallbacks?.attachInteractionManager(im);
    if (this.client === null) {
      const native = this.nativeModule();
      const launch = native?.getLaunchParams() ?? null;
      const params = resolveParams({
        native: launch === null ? null : { ...(launch.port !== null ? { port: launch.port } : {}), ...(launch.session !== null ? { session: launch.session } : {}) },
        global: this.global,
        build: buildConfig,
      });
      this.offline.setExempt(ownConnection(params.port));
      this.network?.setExempt(ownConnection(params.port));
      this.client = new AgentClient({
        params,
        hello: { platform: this.deps.platform(), agentVersion: AGENT_VERSION, nativeModule: native !== null, nativeModulesWrapped: this.nativeModulesWrapped, ...(buildConfig.bundle !== undefined ? { bundle: buildConfig.bundle } : {}) },
        createSocket: (url) => this.deps.createSocket(url),
        handle: (method, p) => this.handle(method, p),
        onReady: (config) => this.configure(config),
        onMessage: () => this.engine.wake(),
        clock: this.clock,
        log: this.log,
      });
    }
    this.client.start();
  }

  private nativeModule(): ReturnType<AppDeps['nativeModule']> {
    if (this.native === undefined) this.native = this.deps.nativeModule();
    return this.native;
  }

  /** The parallel worker index the host sent with its config (Phase 6.12); null before the host connected. */
  workerIndex(): number | null {
    return this.configured ? (this.config.workerIndex ?? 0) : null;
  }

  /**
   * The test launch arguments (`app.device.relaunch({ args })` / config `launchArgs`), read once per JS
   * context. JS-only native builds cannot read them: `{}` with a warning.
   */
  launchArgs(): Record<string, JsonValue> {
    if (this.launchArgsCache !== null) return this.launchArgsCache;
    const native = this.nativeModule();
    const atob = this.global['atob'] as ((s: string) => string) | undefined;
    const { args, problem } = decodeLaunchArgs(native?.getLaunchParams().args, this.global, (b) => {
      if (atob === undefined) throw new Error('atob is not available');
      return atob(b);
    });
    if (problem !== null) this.log(problem);
    else if (native === null && this.deps.platform() !== 'web') this.log('launchArgs(): @quiesco/native is not in the app, so launch arguments cannot be read (returning {})');
    this.launchArgsCache = args;
    return args;
  }

  /** Registered by QuiescoRoot; changes its key so the whole app remounts (soft reset). */
  setRemount(fn: () => void): () => void {
    this.remount = fn;
    return () => {
      if (this.remount === fn) this.remount = null;
    };
  }

  /**
   * The connection stops one tick after the last QuiescoRoot unmounts. A root that is unmounted and
   * mounted again in the same commit (expo-router remounts the root layout after a soft reset on iOS;
   * navigation or theme libraries re-keying the tree do the same) keeps its connection, and with it
   * the in-flight request (e.g. the reset) that caused the remount.
   */
  unmount(): void {
    if (--this.mounted > 0) return;
    if (this.stopTimer !== null) this.clock.clearTimeout(this.stopTimer);
    this.stopTimer = this.clock.setTimeout(() => {
      this.stopTimer = null;
      if (this.mounted <= 0) this.client?.stop();
    }, 0);
  }

  /**
   * A fetch function that the offline mode and the network tracker see like the global one: `expo/fetch`
   * imported directly (src/expo-fetch.js, swapped in by withQuiesco()).
   */
  wrapFetch(original: FetchFn): FetchFn {
    const blocked = this.offline.wrapFetch(original);
    return this.network?.wrapFetch(blocked) ?? blocked;
  }

    configure(config: AgentConfig): void {
    this.config = config;
    this.configured = true;
    this.offline.setOffline(config.network?.offline === true);
    this.network?.setIgnoreUrls(config.sync.ignoreUrls.map(toRegExp));
    this.timer?.configure({ thresholdMs: config.sync.timerThresholdMs, countIntervals: config.sync.countIntervals });
    this.frames?.setFrames(config.sync.stableFrames);
    this.engine.setEnabled({ ...TRACKERS_OFF_BY_DEFAULT, ...config.sync.trackers });
    const nativeCallsOn = config.sync.trackers['native-module'] === true;
    if (nativeCallsOn && !this.nativeModulesWrapped && !this.nativeModulesWarned) {
      this.nativeModulesWarned = true;
      this.log(NATIVE_MODULES_NOT_WRAPPED);
    }
    this.nativeCalls?.configure({
      enabled: nativeCallsOn,
      thresholdMs: config.sync.nativeCallThresholdMs ?? SyncDefaults.nativeCallThresholdMs,
      ignore: (config.sync.ignoreNativeCalls ?? []).map(toRegExp),
    });
    this.events.setLevel(config.logLevel);
    this.configureLogBox(config.logBox ?? 'keep');
  }

  /** `appErrors.logBox: 'ignore'`: no LogBox notifications (issue #31); undone when the host changes it. */
  private configureLogBox(mode: LogBoxMode): void {
    const ignore = mode === 'ignore';
    if (ignore === this.logBoxIgnored) return;
    try {
      this.logBox()?.ignoreAllLogs(ignore);
      this.logBoxIgnored = ignore;
    } catch {
      // LogBox is a dev tool: never fail the connection over it
    }
  }

  /** Before a soft reset (unless `appErrors.logBox: 'keep'`): a LogBox toast from the last scenario would cover the app. */
  private clearLogBox(): void {
    if ((this.config.logBox ?? 'keep') === 'keep') return;
    try {
      this.logBox()?.clearAllLogs();
    } catch {
      // as above
    }
  }

  /** Elements matching `sync.ignoreElements`, left out of the frame-stable snapshot with their subtrees. */
  private ignoredForFrames(roots: readonly HostNode[]): ReadonlySet<HostNode> | undefined {
    const matchers = this.config.sync.ignoreElements ?? [];
    if (matchers.length === 0) return undefined;
    const out = new Set<HostNode>();
    for (const m of matchers) {
      try {
        for (const n of findAll(roots, m)) out.add(n);
      } catch {
        // e.g. a `within` that matches nothing on this screen: nothing to ignore
      }
    }
    return out;
  }

  async handle(method: string, params: unknown): Promise<unknown> {
    const h = (this.handlers as Record<string, ((p: unknown) => Promise<unknown>) | undefined>)[method];
    if (h === undefined) throw new MethodNotFound(method);
    await this.calibrateCoordinates();
    if (!TIMED.has(method)) return h(params ?? {});
    // Phase 6.9 timeline: how much of the call was spent waiting for idle (calls run one at a time), and
    // the steps of a multi-step action (issue #78).
    this.syncSpent = 0;
    this.callStart = this.clock.now();
    this.steps = [];
    const r = await h(params ?? {});
    if (typeof r !== 'object' || r === null) return r;
    return { ...r, syncMs: Math.round(this.syncSpent), ...(this.steps.length > 0 ? { steps: this.steps } : {}) };
  }

  /** When calibrateCoordinates last measured, and the window size then. */
  private calibrated: { at: number; window: string } | null = null;

  /**
   * Rects in window coordinates on every React Native version (FiberAdapter.calibrateCoordinates). The
   * offset changes with the window (rotation) or the status bar (shown / hidden), so it is measured again
   * when the window size changed, else at most every CALIBRATION_INTERVAL_MS: `locate` crosses to the UI
   * thread, and before every call it made the Android suite 30% slower. Needs @quiesco/native (without it
   * touches go through JS, in React Native's own coordinates).
   */
  private async calibrateCoordinates(): Promise<void> {
    const native = this.nativeModule();
    if (native === null) return;
    const w = this.deps.windowInfo();
    const window = `${w.width}x${w.height}`;
    const now = this.clock.now();
    if (this.calibrated !== null && this.calibrated.window === window && now - this.calibrated.at < CALIBRATION_INTERVAL_MS) return;
    this.calibrated = { at: now, window };
    try {
      await this.adapter.calibrateCoordinates(async (tag) => {
        const loc = await native.locate(tag);
        return loc.found && typeof loc.x === 'number' && typeof loc.y === 'number' ? { x: loc.x, y: loc.y } : null;
      });
    } catch {
      // keep the previous offset; the call itself reports what is wrong
    }
  }

  /** Time spent in syncIfNeeded during the current timed call. */
  private syncSpent = 0;
  /** When the current call started, and the steps of a multi-step action so far (issue #78). */
  private callStart = 0;
  private steps: StepTiming[] = [];

  private readonly handlers: Partial<Handlers> = {
    query: async (p) => {
      await this.syncIfNeeded(p);
      const roots = this.adapter.getHostRoots();
      const viewport = this.adapter.viewport();
      return { elements: findAll(roots, p.matcher).map((n) => summarize(n, viewport)) };
    },
    waitForIdle: async (p) => this.engine.waitForIdle({ timeoutMs: p.timeoutMs ?? this.config.sync.timeoutMs }),
    getIdleState: async () => ({ trackers: this.engine.getIdleState() }),
    getTree: async () => ({ root: getTree(this.adapter.getHostRoots()) }),
    listElements: async () => ({ route: this.navigation.current(), ...listElements(this.adapter.getHostRoots(), this.adapter.viewport()) }),
    action: async (p) => this.action(p.action, p.mode, p),
    assert: async (p) => this.assert(p.assertion, p),
    backdoor: async (p) => {
      const value = await this.backdoors.call(p.name, p.args ?? []);
      await this.engine.waitForIdle({ timeoutMs: this.config.sync.timeoutMs });
      return { value };
    },
    configure: async (p) => {
      this.configure(p.config);
      return {};
    },
    deviceInfo: async () => {
      const w = this.deps.windowInfo();
      return { window: { width: w.width, height: w.height }, pixelRatio: w.pixelRatio, appState: this.deps.appState(), ...this.deps.settings() };
    },
    setOrientation: async (p) => {
      const rotate = this.nativeModule()?.setOrientation;
      if (rotate === undefined) return { supported: false };
      const error = await rotate(p.orientation === 'landscape');
      return error === '' ? { supported: true } : { supported: true, error };
    },
    getClipboard: async () => {
      const get = this.nativeModule()?.getClipboard;
      if (get === undefined) return { supported: false };
      return { supported: true, text: await get() };
    },
    setClipboard: async (p) => {
      const set = this.nativeModule()?.setClipboard;
      if (set === undefined) return { supported: false };
      await set(p.text);
      return { supported: true };
    },
    // No wait for idle: it is also called while the app is in the background.
    postNotification: async (p) => {
      const post = this.nativeModule()?.postNotification;
      if (post === undefined) return { supported: false };
      return { supported: true, enabled: (await post(p.title, p.body, p.data)).enabled };
    },
    suspend: async () => {
      const suspend = this.nativeModule()?.suspend;
      if (suspend === undefined) return { suspended: false };
      return { suspended: await suspend() };
    },
    webview: async (p) => this.webview(p.matcher, p.script, p),
    scrollView: async (p) => this.scrollView(p.matcher, p.to, p, p.indicators),
    route: async () => ({ route: this.navigation.current() }),
    reset: async () => {
      const start = this.clock.now();
      this.clearLogBox();
      await this.resets.run(this.remount, this.navigation.active ? () => this.navigation.restore((ms) => this.sleep(ms)) : undefined);
      await this.engine.waitForIdle({ timeoutMs: this.config.sync.timeoutMs });
      const { route, problem } = this.navigation.verify();
      if (problem !== null) throw new QuiescoError('RESET_FAILED', `Soft reset failed at navigation: ${problem}`, { step: 'navigation', message: problem });
      return { durationMs: this.clock.now() - start, ...(route !== null ? { route } : {}) };
    },
  };

  private timeout(opts: SyncOption): number {
    return opts.timeoutMs ?? this.config.sync.timeoutMs;
  }

  private async syncIfNeeded(opts: SyncOption, timeoutMs = this.timeout(opts)): Promise<void> {
    if (opts.sync === false) return;
    const start = this.clock.now();
    try {
      await this.engine.waitForIdle({ timeoutMs, reportedTimeoutMs: this.timeout(opts) });
    } finally {
      this.syncSpent += this.clock.now() - start;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => {
      this.clock.setTimeout(r, ms);
    });
  }

  private summarize(n: HostNode): ElementSummary {
    return summarize(n, this.adapter.viewport());
  }

  /**
   * The single visible element an action targets. Waits (up to the timeout) for it to appear and become
   * visible; several matches fail immediately with MULTIPLE_MATCHES.
   */
  private async resolveTarget(matcher: Matcher, opts: SyncOption, deadline: number, requireVisible = true): Promise<HostNode> {
    return (await this.resolveLoop(matcher, opts, deadline, requireVisible, null)) as HostNode;
  }

  /**
   * Like resolveTarget, but when no host element matches, a component that renders none (Android's
   * DateTimePicker) matched by `id` (its testID) or `type` (its name) is the target (HU 2026-11-09).
   * Such a target has no position: only value actions take it.
   */
  private resolveControlTarget(matcher: Matcher, opts: SyncOption, deadline: number): Promise<HostNode | CompositeNode> {
    return this.resolveLoop(matcher, opts, deadline, true, () => this.hostlessMatches(matcher, true));
  }

  /**
   * Components without a host element matching the `id` / `type` / `index` of `matcher` (other fields: none).
   * `viewless`: also value controls whose host elements all have no size (issue #29: @expo/ui's
   * DateTimePicker in dialog presentation does not pass its testID on and renders a 0-high Host).
   */
  private hostlessMatches(matcher: Matcher, viewless = false): CompositeNode[] {
    const { id, type, index, ...rest } = matcher;
    if (Object.keys(rest).length > 0 || (id === undefined && type === undefined)) return [];
    const idRe = id === undefined ? null : toRegExp(id);
    const all = this.adapter.findHostlessComposites((c, rendersHosts) => {
      if (rendersHosts && !value.isValueControl(c.props)) return false;
      if (type !== undefined && c.name !== type) return false;
      if (idRe === null) return true;
      if (c.testID === undefined) return false;
      return typeof idRe === 'string' ? c.testID === idRe : idRe.test(c.testID);
    }, viewless);
    if (index === undefined) return all;
    const one = all[index];
    return one === undefined ? [] : [one];
  }

  private async resolveLoop(
    matcher: Matcher,
    opts: SyncOption,
    deadline: number,
    requireVisible: boolean,
    fallback: (() => CompositeNode[]) | null,
  ): Promise<HostNode | CompositeNode> {
    for (;;) {
      let busy: QuiescoError | null = null;
      const budget = Math.max(1, deadline - this.clock.now());
      try {
        await this.syncIfNeeded(opts, budget);
      } catch (e) {
        // Out of time while waiting for idle. If the target is not there either, that is the real
        // problem: report it (with what was busy) rather than a sync timeout on the last few ms.
        if (!(e instanceof QuiescoError) || e.errorName !== 'SYNC_TIMEOUT') throw e;
        busy = e;
      }
      const found = findAll(this.adapter.getHostRoots(), matcher);
      if (found.length > 1) {
        throw new QuiescoError('MULTIPLE_MATCHES', `${found.length} elements match ${describeMatcher(matcher)}; add \`index\` or a more specific matcher`, {
          matcher,
          matches: found.map((n) => this.summarize(n)),
        });
      }
      const node = found[0];
      if (node === undefined && fallback !== null) {
        const composites = fallback();
        if (composites.length > 1) {
          throw new QuiescoError('MULTIPLE_MATCHES', `${composites.length} components without a view of their own match ${describeMatcher(matcher)}; add \`index\``, { matcher, matches: [] });
        }
        const only = composites[0];
        if (only !== undefined) {
          if (busy !== null) throw busy;
          return only;
        }
      }
      // Issue #29: a value control that reports no size (@expo/ui) is visible where it is drawn: its
      // nearest ancestor with an area. Only for value actions (they do not touch it, see isSizelessControl).
      const shown = node !== undefined && fallback !== null && value.isSizelessControl(node) ? (sizedAncestor(node) ?? node) : node;
      const visible = node !== undefined && (!requireVisible || isVisible(shown as HostNode, this.adapter.viewport()));
      if (busy !== null && visible) throw busy;
      if (visible) return node;
      if (busy !== null || this.clock.now() >= deadline) {
        const target = describeMatcher(matcher);
        let message = node === undefined ? `No element matches ${target}` : `The element exists but is not visible: ${target}`;
        const reason = shown === undefined ? null : invisibleReason(shown, this.adapter.viewport());
        if (reason !== null) message += `: ${reason}`;
        message += this.whereSuffix();
        // Only a wait that had time to settle says something about the app: the last retry often has a few
        // ms left, less than frame-stable needs to sample a frame (issue #2: "waited 4ms").
        if (busy !== null && budget >= Math.min(MIN_BUSY_REPORT_MS, this.timeout(opts) / 4)) message += ` (the app was also still busy: ${busy.message})`;
        throw new QuiescoError('ELEMENT_NOT_FOUND', message, { matcher });
      }
      await this.sleep(SyncDefaults.retryIntervalMs);
    }
  }

  /**
   * The target of a touch action. In native mode (real touches) a software keyboard covering the target
   * is dismissed first, then the target is looked up again once the app has settled (HU 2026-11-08):
   * a user would close the keyboard to reach it, and on Android an injected touch would otherwise land
   * on the element behind the keyboard.
   */
  private async resolveActionTarget(matcher: Matcher, mode: ParamsOf<AgentMethods['action']>['mode'], opts: SyncOption, deadline: number): Promise<HostNode> {
    const node = await this.resolveTarget(matcher, opts, deadline);
    if (mode !== 'native') return node;
    const keyboard = this.deps.keyboardFrame();
    const rect = node.measure();
    if (keyboard === null || rect === null || !overlaps(keyboard, rect)) return node;
    this.deps.dismissKeyboard();
    return this.resolveTarget(matcher, opts, deadline);
  }

  private async action(spec: ActionSpec, mode: ParamsOf<AgentMethods['action']>['mode'], opts: SyncOption): Promise<ResultOf<AgentMethods['action']>> {
    // Device-level actions are performed by the host's DeviceProvider (adb / simctl / Playwright).
    if (spec.type === 'pressBack') return { hostInput: { kind: 'back' } };
    if (spec.type === 'goBack') {
      // A user closes the keyboard first: on Android the first back press would only close it.
      if (this.deps.keyboardFrame() !== null) {
        this.deps.dismissKeyboard();
        await this.syncIfNeeded(opts);
      }
      return { hostInput: { kind: 'goBack' } };
    }
    if (spec.type === 'openUrl') return this.openUrl(spec.url, opts);

    const timeoutMs = this.timeout(opts);
    const deadline = this.clock.now() + timeoutMs;
    let node: HostNode | undefined;
    let hostInput: HostInput | void = undefined;
    const perform = (matcher: Matcher): ActionPerformer => this.performer(mode, spec.type, matcher, deadline, () => this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now())));

    switch (spec.type) {
      case 'dismissKeyboard':
        await this.syncIfNeeded(opts);
        this.deps.dismissKeyboard();
        break;
      case 'tap':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).tap(node, this.pointInside(node, spec.point, 'tap'));
        break;
      case 'longPress':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).longPress(node, spec.durationMs, this.pointInside(node, spec.point, 'longPress'));
        break;
      case 'doubleTap':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).multiTap(node, 2);
        break;
      case 'multiTap':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).multiTap(node, spec.count);
        break;
      case 'type':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).type(node, spec.text, spec.intervalMs);
        break;
      case 'replaceText':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).replaceText(node, spec.text);
        break;
      case 'clear':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).clear(node);
        break;
      case 'pressKey':
        // The key goes to the field: it needs to exist, not to be visible or reachable by a touch.
        node = await this.resolveExisting(spec.matcher, opts, deadline);
        hostInput = await perform(spec.matcher).pressKey(node, spec.key);
        break;
      case 'scroll':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).scroll(node, spec.direction, spec.distance, spec.from);
        break;
      case 'swipe':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).swipe(node, spec.direction, spec.speed, spec.distance, spec.from);
        break;
      case 'scrollTo':
        node = await this.scrollTo(spec.container, spec.target, opts, deadline, (d) =>
          this.loopablePerformer(this.performer(mode, spec.type, spec.container, d, () => this.syncIfNeeded(opts, Math.max(1, d - this.clock.now())))),
        );
        break;
      case 'scrollToEdge':
        ({ node, hostInput } = await this.scrollToEdge(spec.matcher, spec.edge, mode, opts, deadline, perform(spec.matcher)));
        break;
      case 'scrollToIndex':
        node = await this.scrollToIndex(spec.matcher, spec.index, spec.viewPosition, opts, deadline);
        break;
      case 'drag': {
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        let to: Point;
        if ('point' in spec.to) {
          to = spec.to.point;
        } else {
          const rect = (await this.resolveTarget(spec.to.matcher, opts, deadline)).measure();
          if (rect === null) throw new QuiescoError('ELEMENT_NOT_FOUND', `The drop target ${describeMatcher(spec.to.matcher)} cannot be measured`, { matcher: spec.to.matcher });
          to = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
        hostInput = await perform(spec.matcher).drag(node, to, spec.holdMs ?? DRAG_HOLD_MS, DRAG_MS[spec.speed ?? 'normal']);
        break;
      }
      case 'setValue': {
        const target = await this.resolveControlTarget(spec.matcher, opts, deadline);
        if ('measure' in target) node = target;
        const control = value.detectControl(target, this.deps.platform());
        hostInput = await perform(spec.matcher).setValue(control, spec.value);
        break;
      }
      case 'adjustSlider': {
        if (!(spec.position >= 0 && spec.position <= 1)) throw value.unsupported('adjustSlider', `position must be between 0 and 1, got ${spec.position}`, this.deps.platform());
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        const control = value.detectControl(node, this.deps.platform());
        if (control.kind !== 'slider') throw value.unsupported('adjustSlider', `${describeMatcher(spec.matcher)} is not a slider (found a ${control.kind})`, this.deps.platform());
        hostInput = await perform(spec.matcher).adjustSlider(node, control, spec.position);
        break;
      }
      case 'accessibilityAction': {
        // A screen reader acts on the element wherever it is: it needs to exist, not to be on screen.
        const target = await this.resolveLoop(spec.matcher, opts, deadline, false, () => this.hostlessMatches(spec.matcher));
        if ('measure' in target) node = target;
        const a11y = value.a11yTarget(target);
        if (a11y === null) {
          throw value.unsupported('accessibilityAction', `${describeMatcher(spec.matcher)} declares no accessibilityActions (nor does an ancestor)`, this.deps.platform());
        }
        hostInput = await perform(spec.matcher).accessibilityAction(a11y, spec.name);
        break;
      }
      case 'pinch':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).pinch(node, spec.scale, spec.angle ?? 0, spec.speed ?? 'normal', this.config.gestures?.pinch ?? 0);
        break;
      case 'rotate':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).rotate(node, spec.radians, spec.speed ?? 'normal', this.config.gestures?.rotation ?? 0);
        break;
      case 'multiTouch': {
        // Element coordinates when a target is given (it must be visible and reachable), else window coordinates.
        let origin: Point = { x: 0, y: 0 };
        if (spec.matcher !== undefined) {
          node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
          const r = node.measure();
          if (r !== null) origin = { x: r.x, y: r.y };
        } else {
          await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
        }
        const fingers = spec.fingers.map((f) => f.map((p): [Point, number] => [{ x: origin.x + p.x, y: origin.y + p.y }, p.t]));
        hostInput = await perform(spec.matcher ?? {}).multiTouch(node ?? null, fingers);
        break;
      }
      case 'tapAt':
      case 'longPressAt':
        await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
        hostInput = await perform({}).tapAt(spec.point, spec.type === 'longPressAt' ? (spec.durationMs ?? LONG_PRESS_AT_MS) : undefined);
        break;
    }

    if (hostInput) {
      // The host injects it, then waits for idle itself (Driver).
      return node === undefined ? { hostInput } : { element: this.summarize(node), hostInput };
    }
    // Multi-step scrolls give each step (and the final settle) the full timeout; others share one deadline.
    const multiStep = spec.type === 'scrollToEdge' || spec.type === 'scrollToIndex' || spec.type === 'scrollTo';
    await this.syncIfNeeded(opts, multiStep ? timeoutMs : Math.max(1, deadline - this.clock.now()));
    return node === undefined ? {} : { element: this.summarize(node) };
  }

  /** The single element matching `matcher`, visible or not (keys go to a field, not to a point). */
  private resolveExisting(matcher: Matcher, opts: SyncOption, deadline: number): Promise<HostNode> {
    return this.resolveTarget(matcher, opts, deadline, false);
  }

  /** `point` (element coordinates) checked against the element's size. */
  private pointInside(node: HostNode, point: Point | undefined, action: ActionType): Point | undefined {
    if (point === undefined) return undefined;
    const r = node.measure();
    if (r !== null && (point.x < 0 || point.y < 0 || point.x >= r.width || point.y >= r.height)) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', `point (${point.x}, ${point.y}) is outside the element (${Math.round(r.width)}×${Math.round(r.height)})`, {
        action,
        platform: this.deps.platform(),
        hint: 'points are in the element\'s own coordinates, from its top-left corner',
      });
    }
    return point;
  }

  /**
   * Scroll until the content offset stops changing at `edge`. Real flings in native mode; otherwise
   * (js mode, or web where the host injects input and the agent cannot loop) the ScrollView is set to
   * the edge directly. Every step waits for idle, so virtualized lists render more rows and grow.
   */
  private async scrollToEdge(
    matcher: Matcher,
    edge: Edge,
    mode: ParamsOf<AgentMethods['action']>['mode'],
    opts: SyncOption,
    deadline: number,
    performer: ActionPerformer,
  ): Promise<{ node: HostNode; hostInput: HostInput | void }> {
    const node = await this.resolveActionTarget(matcher, mode, opts, deadline);
    const jsCtx = this.jsContext();
    const scrollable = js.requireScrollable(node, 'scroll', jsCtx);
    const programmatic = mode === 'js' || performer.viaHost;
    // Each step gets the full timeout to settle (a long list takes many flings); MAX_EDGE_STEPS bounds the total.
    for (let step = 0; step < MAX_EDGE_STEPS; step++) {
      const before = scrollable.offset();
      if (programmatic) js.scrollToEdge(scrollable, edge);
      // Real input: fling (a fast swipe with momentum), like a user heading for the end.
      else await performer.swipe(findAll(this.adapter.getHostRoots(), matcher)[0] ?? node, EDGE_FINGER[edge], 'fast');
      await this.syncIfNeeded(opts);
      const after = scrollable.offset();
      if (Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1) break;
    }
    return { node, hostInput: undefined };
  }

  /**
   * Bring row `index` of a FlatList / FlashList into view (all modes: a programmatic scroll, like a
   * user's fling would end). VirtualizedList.scrollToIndex throws (or calls the app's
   * onScrollToIndexFailed) for rows beyond the measured ones when the list has no getItemLayout
   * (findings.md 6.2), so Quiesco first scrolls to the last measured row, waits for the list to render
   * further, and repeats until the row is reachable.
   */
  private async scrollToIndex(matcher: Matcher, index: number, viewPosition: number | undefined, opts: SyncOption, deadline: number): Promise<HostNode> {
    const node = await this.resolveTarget(matcher, opts, deadline);
    const inst = node.findInstance('scrollToIndex');
    if (inst === null) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', `${describeMatcher(matcher)} is not a FlatList / FlashList (no scrollToIndex)`, {
        action: 'scrollToIndex',
        platform: this.deps.platform(),
        hint: 'match the list itself (its testID) or an element inside it; for other scroll views use scrollTo / scrollToEdge',
      });
    }
    let previous = -1;
    for (;;) {
      const raw = inst.raw();
      const props = (typeof raw['props'] === 'object' && raw['props'] !== null ? raw['props'] : {}) as Record<string, unknown>;
      const count = listLength(props);
      if (count !== null && (index < 0 || index >= count)) {
        throw new QuiescoError('ELEMENT_NOT_FOUND', `Row ${index} is out of range: ${describeMatcher(matcher)} has ${count} rows`, { matcher });
      }
      const highest = highestMeasuredRow(raw);
      if (typeof props['getItemLayout'] === 'function' || highest === null || index <= highest) {
        try {
          inst.call({ index, animated: false, ...(viewPosition === undefined ? {} : { viewPosition }) });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          // A list whose measurements Quiesco cannot read: scroll a screen further and try again.
          if (highest === null && message.includes('onScrollToIndexFailed') && (await this.scrollOneScreen(node, opts))) continue;
          throw new QuiescoError('ACTION_NOT_SUPPORTED', `scrollToIndex(${index}) failed: ${message}`, { action: 'scrollToIndex', platform: this.deps.platform() });
        }
        await this.syncIfNeeded(opts);
        return node;
      }
      // Each step gets the full timeout; the loop ends when the list stops growing.
      if (highest <= previous) {
        throw new QuiescoError('ELEMENT_NOT_FOUND', `Row ${index} of ${describeMatcher(matcher)} was not rendered (the list stopped at row ${highest})`, { matcher });
      }
      previous = highest;
      inst.call({ index: highest, viewPosition: 0, animated: false });
      await this.syncIfNeeded(opts);
    }
  }

  /** Scroll the list containing `node` down by a screen and wait for idle; false at the end. */
  private async scrollOneScreen(node: HostNode, opts: SyncOption): Promise<boolean> {
    const s = js.findScrollable(node);
    if (s === null) return false;
    const before = s.offset();
    js.scrollBy(s, 'down');
    await this.syncIfNeeded(opts);
    const after = s.offset();
    return Math.abs(after.y - before.y) >= 1 || Math.abs(after.x - before.x) >= 1;
  }

  private jsContext(): js.JsActionContext {
    return {
      platform: this.deps.platform(),
      roots: () => this.adapter.getHostRoots(),
      sleep: (ms) =>
        new Promise((r) => {
          this.clock.setTimeout(r, ms);
        }),
    };
  }

  /**
   * Deep links: inside the app when the native module can (iOS, where `simctl openurl` would show a
   * system confirmation alert), otherwise by the host (`am start` on Android, the address bar on web).
   * Independent of the action mode: no touch is involved.
   */
  private async openUrl(url: string, opts: SyncOption): Promise<ResultOf<AgentMethods['action']>> {
    const bridge = this.nativeModule();
    if (bridge?.openUrl === undefined) return { hostInput: { kind: 'navigate', url } };
    const timeoutMs = this.timeout(opts);
    let opened: boolean;
    try {
      ({ opened } = await bridge.openUrl(url));
    } catch (e) {
      throw fromNativeError(e, 'openUrl', 'openUrl', {});
    }
    if (!opened) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', `The system refused to open ${url} (is its scheme registered by this app?)`, {
        action: 'openUrl',
        platform: this.deps.platform(),
      });
    }
    await this.syncIfNeeded(opts, timeoutMs);
    return {};
  }

  /**
   * `js`: component callbacks. `native`: real input through @quiesco/native when the app has it,
   * otherwise the host injects real input (web via Playwright); a host that cannot inject a kind of
   * input rejects it with ACTION_NOT_SUPPORTED.
   */
  private performer(mode: ParamsOf<AgentMethods['action']>['mode'], action: ActionType, matcher: Matcher, deadline: number, settle?: () => Promise<void>): ActionPerformer {
    if (mode === 'js') return jsPerformer(this.jsContext());
    const roots = (): HostNode[] => this.adapter.getHostRoots();
    // Issue #38: what React Native draws over the app outside <QuiescoRoot> (LogBox) covers it too.
    const hitRoots = (): HostNode[] => this.adapter.getAllHostRoots();
    const viewport = (): ReturnType<FiberAdapter['viewport']> => this.adapter.viewport();
    const bridge: NativeBridge | null = this.nativeModule();
    if (bridge === null) return hostPerformer({ clock: this.clock, roots, hitRoots, viewport, matcher, deadline });
    return nativePerformer({ bridge, clock: this.clock, roots, hitRoots, viewport, action, matcher, deadline, ...(settle !== undefined ? { settle } : {}) });
  }

  /** scrollTo loops in the agent; with host-injected input it scrolls with the JS fallback instead. */
  private loopablePerformer(p: ActionPerformer): ActionPerformer {
    return p.viaHost ? jsPerformer(this.jsContext()) : p;
  }

  /**
   * Scroll `container` until the center of `target` is visible (where a tap goes, issue #45): down until
   * the offset stops changing, then up; right / left for a horizontal scroll view (issue #46). Each step
   * waits for idle so lists can render more items. At an end, a visible target whose center stays
   * clipped is returned too.
   *
   * A multi-step action (issue #63): `deadline` bounds finding the container; then every step (drag and
   * settle) gets the full call timeout, and MAX_SCROLL_TO_STEPS bounds the steps.
   */
  private async scrollTo(container: Matcher, target: Matcher, opts: SyncOption, deadline: number, performerFor: (deadline: number) => ActionPerformer): Promise<HostNode> {
    const containerNode = await this.resolveTarget(container, opts, deadline);
    const timeoutMs = this.timeout(opts);
    // Offset readout (layout-based, works in both modes) to notice the end of the content.
    const scrollable = js.findScrollable(containerNode);
    const MAX_STEPS_WITHOUT_OFFSET = 10;
    const vp = scrollable?.viewport();
    const content = scrollable?.content();
    const horizontal = vp != null && content != null && content.width > vp.width + 1 && content.height <= vp.height + 1;
    const visibleTargets = (centered: boolean): HostNode[] => {
      const viewport = this.adapter.viewport();
      const visible = findAll(this.adapter.getHostRoots(), target).filter((n) => (centered ? isCenterVisible(n, viewport) : isVisible(n, viewport)));
      if (visible.length > 1) {
        throw new QuiescoError('MULTIPLE_MATCHES', `${visible.length} elements match ${describeMatcher(target)}`, { matcher: target, matches: visible.map((n) => this.summarize(n)) });
      }
      return visible;
    };
    let steps = 0;
    const ends: string[] = [];
    for (const direction of horizontal ? (['right', 'left'] as const) : (['down', 'up'] as const)) {
      for (let step = 0; ; step++) {
        const centered = visibleTargets(true);
        if (centered.length === 1) return centered[0] as HostNode;
        if (steps >= MAX_SCROLL_TO_STEPS) throw this.scrollToGaveUp(container, target, scrollable, steps, ends);
        if (scrollable === null && step >= MAX_STEPS_WITHOUT_OFFSET) break;
        steps++;
        const stepStart = this.clock.now();
        const stepSync = this.syncSpent;
        const stepDeadline = stepStart + timeoutMs;
        const before = scrollable?.offset();
        const current = findAll(this.adapter.getHostRoots(), container)[0] ?? containerNode;
        let after: { x: number; y: number } | undefined;
        try {
          await performerFor(stepDeadline).scroll(current, direction, vp == null ? undefined : (horizontal ? vp.width : vp.height) * SCROLL_TO_STEP, undefined, true);
          await this.syncIfNeeded(opts, Math.max(1, stepDeadline - this.clock.now()));
          after = scrollable?.offset();
          if (scrollable != null && before !== undefined && after !== undefined && Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1 && !js.atEdge(scrollable, direction)) {
            // The drag did not move the content, though there is more of it: something under the finger took
            // the drag (a wheel picker, a slider). Scroll this step programmatically instead.
            js.scrollBy(scrollable, direction, vp == null ? undefined : (horizontal ? vp.width : vp.height) * SCROLL_TO_STEP);
            await this.syncIfNeeded(opts, Math.max(1, stepDeadline - this.clock.now()));
            after = scrollable.offset();
          }
        } catch (e) {
          this.recordStep(stepStart, stepSync, direction);
          throw this.inScrollToStep(e, container, target, scrollable, steps, direction);
        }
        this.recordStep(stepStart, stepSync, direction);
        if (before !== undefined && after !== undefined && Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1) {
          // Reached the end: a target this far in that still has its center clipped (e.g. under an
          // overlay that clips) is as good as it gets.
          const partly = visibleTargets(false);
          if (partly.length === 1) return partly[0] as HostNode;
          ends.push(EDGE_OF[direction]);
          break;
        }
      }
    }
    if (scrollable === null) {
      throw new QuiescoError('ELEMENT_NOT_FOUND', `Scrolled ${describeMatcher(container)} ${MAX_STEPS_WITHOUT_OFFSET} steps each way without finding a visible ${describeMatcher(target)} (its scroll offset cannot be read, so its ends are unknown)`, { matcher: target });
    }
    throw new QuiescoError('ELEMENT_NOT_FOUND', `Scrolled ${describeMatcher(container)} to both ends (${steps} steps) without finding a visible ${describeMatcher(target)}`, { matcher: target, steps: [...this.steps] });
  }

  /** Record a step of a multi-step action that started at `start` with `syncSpent` at `syncBefore` (issue #78). */
  private recordStep(start: number, syncBefore: number, label: string): void {
    const now = this.clock.now();
    const step = { atMs: Math.round(start - this.callStart), ms: Math.round(now - start), syncMs: Math.round(this.syncSpent - syncBefore), label };
    this.steps.push(step);
    this.client?.notify('step', step);
  }

  /**
   * A SYNC_TIMEOUT inside a scrollTo step, with the step it happened in (issue #78): which step of how
   * many, the scroll offset, the direction and how long the earlier steps took. Other errors pass.
   */
  private inScrollToStep(e: unknown, container: Matcher, target: Matcher, scrollable: js.Scrollable | null, step: number, direction: string): unknown {
    if (!(e instanceof QuiescoError) || e.errorName !== 'SYNC_TIMEOUT') return e;
    const data = e.data as ErrorDataMap['SYNC_TIMEOUT'];
    const o = scrollable?.offset();
    const at = o === undefined ? '' : `, offset ${JSON.stringify({ x: Math.round(o.x), y: Math.round(o.y) })}`;
    const earlier = this.steps.slice(0, -1).map((s) => s.ms);
    const sec = (ms: number) => (ms / 1000).toFixed(1);
    const previous = earlier.length === 0 ? '' : `, previous steps ${earlier.length === 1 || Math.min(...earlier) === Math.max(...earlier) ? sec(earlier[0] as number) : `${sec(Math.min(...earlier))}–${sec(Math.max(...earlier))}`} s`;
    return new QuiescoError(
      'SYNC_TIMEOUT',
      `scrollTo ${describeMatcher(container)} → ${describeMatcher(target)}: step ${step} of at most ${MAX_SCROLL_TO_STEPS}${at}, direction ${direction}${previous}: ${e.message}`,
      { ...data, steps: [...this.steps] },
    );
  }

  /** scrollTo ran out of steps before reaching both ends (issue #63): say where it stopped. */
  private scrollToGaveUp(container: Matcher, target: Matcher, scrollable: js.Scrollable | null, steps: number, ends: string[]): QuiescoError {
    const o = scrollable?.offset();
    const at = o === undefined ? '' : ` at offset ${JSON.stringify({ x: Math.round(o.x), y: Math.round(o.y) })}`;
    const reached = ends.length === 0 ? 'no end reached' : `reached the ${ends.join(' end, then the ')} end`;
    return new QuiescoError(
      'ELEMENT_NOT_FOUND',
      `Gave up scrolling ${describeMatcher(container)} after ${steps} steps${at} (${reached}) without finding a visible ${describeMatcher(target)}. Use scrollToIndex for a long list.`,
      { matcher: target, steps: [...this.steps] },
    );
  }

  /**
   * A WebView (Phase 6.8): react-native-webview's native view (iOS / Android, through @quiesco/native) or
   * an `<iframe>` (web, which the host drives through Playwright's frames). Evaluates `script` in the
   * native page; the page logic itself lives in the host (@quiesco/core webview.ts).
   */
  private async webview(matcher: Matcher | undefined, script: string | undefined, opts: SyncOption): Promise<ResultOf<AgentMethods['webview']>> {
    const deadline = this.clock.now() + this.timeout(opts);
    const node = await this.resolveWebView(matcher, opts, deadline);
    const rect = node.measure();
    const what = matcher === undefined ? 'the WebView' : describeMatcher(matcher);
    if (rect === null) throw new QuiescoError('ELEMENT_NOT_FOUND', `${what} cannot be measured`, { matcher: matcher ?? {} });
    if (this.deps.platform() === 'web') return { rect, viaHost: true };
    const native = this.nativeModule();
    const tag = node.nativeTag();
    if (native?.webviewEval === undefined || native.webviewInfo === undefined || tag === null) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', `WebViews need @quiesco/native${native === null ? '' : ' built with Phase 6.8 (rebuild the app)'}`, {
        action: 'webview',
        platform: this.deps.platform(),
        hint: 'add @quiesco/native to the app and rebuild it: Quiesco evaluates scripts in the WebView natively',
      });
    }
    if (!this.hookedWebViews.has(tag)) {
      this.hookedWebViews.add(tag);
      await native.webviewAddStartScript?.(tag, WEBVIEW_HOOK).catch(() => false);
    }
    const info = await native.webviewInfo(tag);
    if (!info.found) throw new QuiescoError('ELEMENT_NOT_FOUND', `${what} contains no WebView (react-native-webview)`, { matcher: matcher ?? {} });
    // The web content's own rect: below an inset (iOS content inset), maybe smaller than the host.
    const web: Rect = {
      x: (info.x ?? rect.x) + (info.insetLeft ?? 0),
      y: (info.y ?? rect.y) + (info.insetTop ?? 0),
      width: info.width ?? rect.width,
      height: info.height ?? rect.height,
    };
    if (script === undefined) return { rect: web, loading: info.loading === true };
    let value: string;
    try {
      value = await native.webviewEval(tag, script);
    } catch (e) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', `evaluating a script in ${what} failed: ${e instanceof Error ? e.message : String(e)}`, { action: 'webview', platform: this.deps.platform() });
    }
    return { rect: web, loading: info.loading === true, value };
  }

  /**
   * The scroll view containing the element matching `matcher`, or the largest visible one (Phase 6.9
   * full-page screenshots); scrolled to `to` first when given.
   */
  private async scrollView(matcher: Matcher | undefined, to: { x: number; y: number } | undefined, opts: SyncOption, indicators?: boolean): Promise<ResultOf<AgentMethods['scrollView']>> {
    const deadline = this.clock.now() + this.timeout(opts);
    let scrollable: js.Scrollable | null;
    if (matcher !== undefined) {
      const node = await this.resolveTarget(matcher, opts, deadline);
      scrollable = js.findScrollable(node);
      if (scrollable === null) {
        throw new QuiescoError('ACTION_NOT_SUPPORTED', `${describeMatcher(matcher)} is not a scroll view nor inside one`, { action: 'scroll', platform: this.deps.platform() });
      }
    } else {
      await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
      const viewport = this.adapter.viewport();
      let best: { s: js.Scrollable; area: number } | null = null;
      // Scroll views clip their content (on the web RN's ScrollView is a plain div, without a 'scroll' type).
      for (const n of findAll(this.adapter.getHostRoots(), {})) {
        if (!n.clipsContent || !isVisible(n, viewport)) continue;
        const s = js.findScrollable(n);
        const r = s?.viewport();
        if (s == null || r == null) continue;
        const area = r.width * r.height;
        if (best === null || area > best.area) best = { s, area };
      }
      if (best === null) throw new QuiescoError('ELEMENT_NOT_FOUND', 'No scroll view on screen (a full-page screenshot needs a ScrollView / FlatList)', { matcher: { type: 'scroll' } });
      scrollable = best.s;
    }
    let indicatorsWere: boolean | undefined;
    if (indicators !== undefined) {
      const tag = scrollable.host()?.nativeTag() ?? null;
      const was = tag === null ? -1 : await (this.nativeModule()?.setScrollIndicators?.(tag, indicators) ?? Promise.resolve(-1)).catch(() => -1);
      if (was >= 0) indicatorsWere = was === 1;
    }
    if (to !== undefined) {
      scrollable.scrollTo(to.x, to.y);
      await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
    }
    const rect = scrollable.viewport();
    const content = scrollable.content();
    if (rect === null || content === null) throw new QuiescoError('ELEMENT_NOT_FOUND', 'The scroll view cannot be measured', { matcher: matcher ?? { type: 'scroll' } });
    return { rect, offset: scrollable.offset(), content: { width: content.width, height: content.height }, ...(indicatorsWere !== undefined ? { indicatorsWere } : {}) };
  }

  /** The single visible WebView matching `matcher`, or the only one on screen. Waits for it like an action target. */
  private async resolveWebView(matcher: Matcher | undefined, opts: SyncOption, deadline: number): Promise<HostNode> {
    if (matcher !== undefined) {
      const node = await this.resolveTarget(matcher, opts, deadline);
      if (this.deps.platform() !== 'web' || node.type === 'iframe') return node;
      // A wrapper matched (e.g. a View with the testID around the iframe): the iframe inside it.
      const inner = findAll([node], { type: 'iframe' });
      if (inner.length === 1) return inner[0] as HostNode;
      throw new QuiescoError('ELEMENT_NOT_FOUND', `${describeMatcher(matcher)} is a ${node.type}, not a WebView (no single <iframe> inside it)`, { matcher });
    }
    for (;;) {
      await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
      const viewport = this.adapter.viewport();
      const all = findAll(this.adapter.getHostRoots(), {}).filter((n) => isWebViewHost(n.type) && isVisible(n, viewport));
      // A WebView's native view inside another WebView host (a wrapper with the same name): the outermost.
      const outer = all.filter((n) => !all.some((o) => o !== n && isAncestor(o, n)));
      if (outer.length === 1) return outer[0] as HostNode;
      if (outer.length > 1) {
        throw new QuiescoError('MULTIPLE_MATCHES', `${outer.length} WebViews are on screen; pass a matcher to app.webview() (e.g. its testID)`, { matcher: {}, matches: outer.map((n) => this.summarize(n)) });
      }
      if (this.clock.now() >= deadline) throw new QuiescoError('ELEMENT_NOT_FOUND', 'No WebView on screen (react-native-webview, or an <iframe> on the web)', { matcher: {} });
      await this.sleep(SyncDefaults.retryIntervalMs);
    }
  }

  private async assert(spec: AssertionSpec, opts: SyncOption): Promise<ResultOf<AgentMethods['assert']>> {
    const timeoutMs = this.timeout(opts);
    const deadline = this.clock.now() + timeoutMs;
    let synced = false;
    for (;;) {
      try {
        await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
        synced = true;
      } catch (e) {
        // Once the app has been idle in this call, a later retry's sync cut short by the deadline (a
        // few ms left, less than the frames frame-stable needs) must not hide the real outcome: the
        // expectation did not hold. Never idle at all stays a SYNC_TIMEOUT.
        if (!(synced && e instanceof QuiescoError && e.errorName === 'SYNC_TIMEOUT')) throw e;
      }
      const ev = evaluate(this.adapter.getHostRoots(), spec, this.adapter.viewport());
      if (ev.pass) return { elements: ev.elements };
      if (this.clock.now() >= deadline) {
        let message = assertionMessage(spec, ev, timeoutMs, describeMatcher(spec.matcher));
        if (spec.type === 'visible' && ev.actual === 'not visible') {
          const node = findAll(this.adapter.getHostRoots(), spec.matcher)[0];
          const reason = node === undefined ? null : invisibleReason(node, this.adapter.viewport());
          if (reason !== null) message += `: ${reason}`;
        }
        message += this.whereSuffix();
        throw new QuiescoError('ASSERTION_FAILED', message, {
          expected: ev.expected,
          actual: ev.actual,
          elements: ev.elements,
        });
      }
      await this.sleep(SyncDefaults.retryIntervalMs);
    }
  }

  /** ` (current route: /students/new)` for failure messages (issue #2), empty without Expo Router. */
  private whereSuffix(): string {
    const route = this.navigation.current();
    return route === null ? '' : ` (current route: ${route})`;
  }

  private defaultTrackers(): IdleTracker[] {
    this.network = new NetworkTracker({ target: this.global });
    this.timer = new TimerTracker({ target: this.global as unknown as TimerGlobals });
    this.frames = new FrameStableTracker({
      snapshot: () => {
        const roots = this.adapter.getHostRoots();
        return structureLines(roots, this.ignoredForFrames(roots));
      },
    });
    return [
      this.network,
      this.timer,
      new ReactTracker(this.adapter),
      (this.idleCallbacks = new IdleCallbackTracker({ target: this.global })),
      this.frames,
      new NativeSettleTracker(() => this.nativeModule()),
      (this.nativeCalls = new NativeModuleTracker({
        sources: {
          registry: () => this.deps.nativeModuleSources?.().registry ?? null,
          expo: () => this.deps.nativeModuleSources?.().expo ?? null,
        },
        clock: this.clock,
        skip: NATIVE_MODULES_NOT_TRACKED,
        wrap: this.nativeModulesWrapped,
      })),
    ];
  }
}

/** Host types of a WebView: react-native-webview's native component, or an iframe on the web. */
function isWebViewHost(type: string): boolean {
  return type === 'iframe' || /^RNC?WebView$/.test(type);
}

function isAncestor(a: HostNode, b: HostNode): boolean {
  for (let p = b.parent; p !== null; p = p.parent) if (p === a || p.isSameElement(a)) return true;
  return false;
}

/** Whether two rects share some area (touching edges do not count). */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Number of rows of a VirtualizedList-like component from its props, or null if unknown. */
function listLength(props: Record<string, unknown>): number | null {
  const getItemCount = props['getItemCount'];
  try {
    if (typeof getItemCount === 'function') {
      const n = (getItemCount as (d: unknown) => unknown)(props['data']);
      if (typeof n === 'number') return n;
    }
  } catch {
    // fall through
  }
  const data = props['data'];
  return Array.isArray(data) ? data.length : null;
}

/**
 * Highest row index a VirtualizedList has measured: RN 0.88 `_listMetrics.getHighestMeasuredCellIndex()`,
 * react-native-web `_highestMeasuredFrameIndex`; FlatList keeps its VirtualizedList in `_listRef`. Null
 * when unknown (other list implementations: their scrollToIndex is called directly, with a fallback).
 */
function highestMeasuredRow(raw: Record<string, unknown>): number | null {
  const isList = (o: Record<string, unknown>): boolean => typeof o['_listMetrics'] === 'object' || typeof o['_highestMeasuredFrameIndex'] === 'number';
  const list = (isList(raw) ? raw : raw['_listRef']) as Record<string, unknown> | null | undefined;
  if (list === null || list === undefined) return null;
  // react-native-web's vendored VirtualizedList keeps the older field.
  if (typeof list['_highestMeasuredFrameIndex'] === 'number') return list['_highestMeasuredFrameIndex'];
  const metrics = list['_listMetrics'] as { getHighestMeasuredCellIndex?: () => unknown } | undefined;
  try {
    const n = metrics?.getHighestMeasuredCellIndex?.();
    return typeof n === 'number' ? n : null;
  } catch {
    return null;
  }
}
