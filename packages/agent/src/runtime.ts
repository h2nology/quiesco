/**
 * The agent runtime: owns the fiber adapter, the trackers, the connection and the request handlers.
 * One instance per JS context, created when `@quiesco/agent` is first imported (it must be the first
 * import of the app entry, so the DevTools hook and scheduler patch precede the renderer).
 */
import { SyncDefaults } from '@quiesco/protocol';
import type {
  ActionSpec,
  ActionType,
  HostInput,
  AgentConfig,
  AgentMethods,
  AssertionSpec,
  ElementSummary,
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
import type { StorageAdapter } from './api-types';
import { assertionMessage, evaluate } from './assertions';
import { BackdoorRegistry } from './backdoor';
import { buildConfig } from './build-config';
import { AgentClient, MethodNotFound } from './connection/client';
import { resolveParams } from './connection/params';
import { QuiescoError } from './errors';
import { EventForwarder } from './events';
import { FiberAdapter } from './fiber-adapter';
import type { FiberAdapterOptions, HostNode } from './fiber-adapter';
import type { AppDeps } from './platform';
import { defaultAppDeps } from './platform';
import { ResetManager } from './reset';
import { defaultStorageAdapters } from './reset/storage-defaults';
import { describeMatcher, findAll, getTree, isVisible, structureLines, summarize, toRegExp } from './query';
import type { Clock, IdleTracker, TimerGlobals } from './sync';
import { FrameStableTracker, IdleCallbackTracker, NetworkTracker, ReactTracker, SyncEngine, TimerTracker, realClock } from './sync';
import { AGENT_VERSION } from './version';

export interface RuntimeOptions {
  adapter?: FiberAdapterOptions;
  deps?: AppDeps;
  clock?: Clock;
  globalObject?: Record<string, unknown>;
  /** Trackers to use instead of the default set (tests). */
  trackers?: (runtime: AgentRuntime) => IdleTracker[];
  /** Built-in storage adapters (default: AsyncStorage on native, web storage on web). */
  storage?: () => StorageAdapter[];
}

type Handlers = { [M in keyof AgentMethods]: (params: ParamsOf<AgentMethods[M]>) => Promise<ResultOf<AgentMethods[M]>> };

export class AgentRuntime {
  readonly adapter: FiberAdapter;
  readonly engine: SyncEngine;
  readonly events: EventForwarder;
  readonly backdoors = new BackdoorRegistry();
  readonly resets: ResetManager;
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
  private readonly clock: Clock;
  private readonly global: Record<string, unknown>;
  private network: NetworkTracker | null = null;
  private timer: TimerTracker | null = null;
  private frames: FrameStableTracker | null = null;
  private idleCallbacks: IdleCallbackTracker | null = null;
  private mounted = 0;
  private remount: (() => void) | null = null;
  private native: ReturnType<AppDeps['nativeModule']> | undefined;
  /** Pending stop after the last QuiescoRoot unmounted (see unmount). */
  private stopTimer: unknown = null;
  /** Original console methods, captured before the event forwarder wraps them. */
  private readonly log: (message: string) => void;

  constructor(options: RuntimeOptions = {}) {
    this.global = options.globalObject ?? (globalThis as unknown as Record<string, unknown>);
    this.deps = options.deps ?? defaultAppDeps;
    this.clock = options.clock ?? realClock;
    this.adapter = new FiberAdapter({ target: this.global, ...options.adapter });
    const c = this.global['console'] as { warn?: (...a: unknown[]) => void } | undefined;
    const warn = c?.warn;
    this.log = (m) => warn?.call(c, `[quiesco] ${m}`);
    this.engine = new SyncEngine(options.trackers?.(this) ?? this.defaultTrackers(), this.clock);
    this.resets = new ResetManager(options.storage ?? (() => defaultStorageAdapters()));
    this.events = new EventForwarder({ notify: (e, p) => this.client?.notify(e, p), target: this.global });
  }

  /** Called at import time: everything that must precede the renderer and the app's first effects. */
  installEarly(): void {
    this.adapter.install();
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
      this.client = new AgentClient({
        params,
        hello: { platform: this.deps.platform(), agentVersion: AGENT_VERSION, nativeModule: native !== null },
        createSocket: (url) => this.deps.createSocket(url),
        handle: (method, p) => this.handle(method, p),
        onReady: (config) => this.configure(config),
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

  configure(config: AgentConfig): void {
    this.config = config;
    this.network?.setIgnoreUrls(config.sync.ignoreUrls.map(toRegExp));
    this.timer?.configure({ thresholdMs: config.sync.timerThresholdMs, countIntervals: config.sync.countIntervals });
    this.frames?.setFrames(config.sync.stableFrames);
    this.engine.setEnabled(config.sync.trackers);
    this.events.setLevel(config.logLevel);
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

  handle(method: string, params: unknown): Promise<unknown> {
    const h = (this.handlers as Record<string, ((p: unknown) => Promise<unknown>) | undefined>)[method];
    if (h === undefined) return Promise.reject(new MethodNotFound(method));
    return h(params ?? {});
  }

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
    action: async (p) => this.action(p.action, p.mode, p),
    assert: async (p) => this.assert(p.assertion, p),
    backdoor: async (p) => {
      const value = await this.backdoors.call(p.name, p.args ?? []);
      await this.engine.waitForIdle({ timeoutMs: this.config.sync.timeoutMs });
      return { value };
    },
    reset: async () => {
      const start = this.clock.now();
      await this.resets.run(this.remount);
      await this.engine.waitForIdle({ timeoutMs: this.config.sync.timeoutMs });
      return { durationMs: this.clock.now() - start };
    },
  };

  private timeout(opts: SyncOption): number {
    return opts.timeoutMs ?? this.config.sync.timeoutMs;
  }

  private async syncIfNeeded(opts: SyncOption, timeoutMs = this.timeout(opts)): Promise<void> {
    if (opts.sync !== false) await this.engine.waitForIdle({ timeoutMs, reportedTimeoutMs: this.timeout(opts) });
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
  private async resolveTarget(matcher: Matcher, opts: SyncOption, deadline: number): Promise<HostNode> {
    for (;;) {
      let busy: QuiescoError | null = null;
      try {
        await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
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
      const visible = node !== undefined && isVisible(node, this.adapter.viewport());
      if (busy !== null && visible) throw busy;
      if (visible) return node;
      if (busy !== null || this.clock.now() >= deadline) {
        const why = node === undefined ? 'No element matches' : 'The element exists but is not visible:';
        const alsoBusy = busy === null ? '' : ` (the app was also still busy: ${busy.message})`;
        throw new QuiescoError('ELEMENT_NOT_FOUND', `${why} ${describeMatcher(matcher)}${alsoBusy}`, { matcher });
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
    if (spec.type === 'openUrl') return this.openUrl(spec.url, opts);

    const timeoutMs = this.timeout(opts);
    const deadline = this.clock.now() + timeoutMs;
    let node: HostNode | undefined;
    let hostInput: HostInput | void = undefined;
    const perform = (matcher: Matcher): ActionPerformer => this.performer(mode, spec.type, matcher, deadline);

    switch (spec.type) {
      case 'dismissKeyboard':
        await this.syncIfNeeded(opts);
        this.deps.dismissKeyboard();
        break;
      case 'tap':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).tap(node);
        break;
      case 'longPress':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).longPress(node, spec.durationMs);
        break;
      case 'doubleTap':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).doubleTap(node);
        break;
      case 'type':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).type(node, spec.text);
        break;
      case 'clear':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).clear(node);
        break;
      case 'scroll':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).scroll(node, spec.direction, spec.distance);
        break;
      case 'swipe':
        node = await this.resolveActionTarget(spec.matcher, mode, opts, deadline);
        hostInput = await perform(spec.matcher).swipe(node, spec.direction, spec.speed);
        break;
      case 'scrollTo':
        node = await this.scrollTo(spec.container, spec.target, opts, deadline, this.loopablePerformer(perform(spec.container)));
        break;
    }

    if (hostInput) {
      // The host injects it, then waits for idle itself (Driver).
      return node === undefined ? { hostInput } : { element: this.summarize(node), hostInput };
    }
    await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
    return node === undefined ? {} : { element: this.summarize(node) };
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
  private performer(mode: ParamsOf<AgentMethods['action']>['mode'], action: ActionType, matcher: Matcher, deadline: number): ActionPerformer {
    if (mode === 'js') return jsPerformer({ platform: this.deps.platform() });
    const roots = (): HostNode[] => this.adapter.getHostRoots();
    const viewport = (): ReturnType<FiberAdapter['viewport']> => this.adapter.viewport();
    const bridge: NativeBridge | null = this.nativeModule();
    if (bridge === null) return hostPerformer({ clock: this.clock, roots, viewport, matcher, deadline });
    return nativePerformer({ bridge, clock: this.clock, roots, viewport, action, matcher, deadline });
  }

  /** scrollTo loops in the agent; with host-injected input it scrolls with the JS fallback instead. */
  private loopablePerformer(p: ActionPerformer): ActionPerformer {
    return p.viaHost ? jsPerformer({ platform: this.deps.platform() }) : p;
  }

  /**
   * Scroll `container` until `target` is visible: down until the offset stops changing, then up.
   * Each step waits for idle so lists can render more items.
   */
  private async scrollTo(container: Matcher, target: Matcher, opts: SyncOption, deadline: number, performer: ActionPerformer): Promise<HostNode> {
    const containerNode = await this.resolveTarget(container, opts, deadline);
    // Offset readout (layout-based, works in both modes) to notice the end of the content.
    const scrollable = js.findScrollable(containerNode);
    const MAX_STEPS_WITHOUT_OFFSET = 10;
    for (const direction of ['down', 'up'] as const) {
      for (let step = 0; ; step++) {
        const visible = findAll(this.adapter.getHostRoots(), target).filter((n) => isVisible(n, this.adapter.viewport()));
        if (visible.length === 1) return visible[0] as HostNode;
        if (visible.length > 1) {
          throw new QuiescoError('MULTIPLE_MATCHES', `${visible.length} elements match ${describeMatcher(target)}`, { matcher: target, matches: visible.map((n) => this.summarize(n)) });
        }
        if (this.clock.now() >= deadline || (scrollable === null && step >= MAX_STEPS_WITHOUT_OFFSET)) break;
        const before = scrollable?.offset();
        const current = findAll(this.adapter.getHostRoots(), container)[0] ?? containerNode;
        await performer.scroll(current, direction);
        await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
        const after = scrollable?.offset();
        if (before !== undefined && after !== undefined && Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1) break; // reached the end
      }
    }
    throw new QuiescoError('ELEMENT_NOT_FOUND', `Scrolled ${describeMatcher(container)} to both ends without finding a visible ${describeMatcher(target)}`, { matcher: target });
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
        throw new QuiescoError('ASSERTION_FAILED', assertionMessage(spec, ev, timeoutMs, describeMatcher(spec.matcher)), {
          expected: ev.expected,
          actual: ev.actual,
          elements: ev.elements,
        });
      }
      await this.sleep(SyncDefaults.retryIntervalMs);
    }
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
    ];
  }
}

/** Whether two rects share some area (touching edges do not count). */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
