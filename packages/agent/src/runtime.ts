/**
 * The agent runtime: owns the fiber adapter, the trackers, the connection and the request handlers.
 * One instance per JS context, created when `@quiesco/agent` is first imported (it must be the first
 * import of the app entry, so the DevTools hook and scheduler patch precede the renderer).
 */
import { SyncDefaults } from '@quiesco/protocol';
import type {
  ActionSpec,
  AgentConfig,
  AgentMethods,
  AssertionSpec,
  ElementSummary,
  Matcher,
  ParamsOf,
  ResultOf,
  SyncOption,
} from '@quiesco/protocol';

import * as js from './actions/js';
import { assertionMessage, evaluate } from './assertions';
import { buildConfig } from './build-config';
import { AgentClient, MethodNotFound } from './connection/client';
import { resolveParams } from './connection/params';
import { QuiescoError } from './errors';
import { EventForwarder } from './events';
import { FiberAdapter } from './fiber-adapter';
import type { FiberAdapterOptions, HostNode } from './fiber-adapter';
import type { AppDeps } from './platform';
import { defaultAppDeps } from './platform';
import { describeMatcher, findAll, getTree, isVisible, structureHash, summarize, toRegExp } from './query';
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
}

type Handlers = { [M in keyof AgentMethods]: (params: ParamsOf<AgentMethods[M]>) => Promise<ResultOf<AgentMethods[M]>> };

export class AgentRuntime {
  readonly adapter: FiberAdapter;
  readonly engine: SyncEngine;
  readonly events: EventForwarder;
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
    this.adapter.setScope(scopeComponent);
    const problems = [...this.adapter.diagnostics().problems];
    const late = this.adapter.checkRendererSeen();
    if (late !== null) problems.push(late);
    for (const p of problems) this.log(p);
    const im = this.deps.interactionManager();
    if (im !== null) this.idleCallbacks?.attachInteractionManager(im);
    if (this.client === null) {
      const params = resolveParams({ native: this.deps.nativeLaunchParams(), global: this.global, build: buildConfig });
      this.client = new AgentClient({
        params,
        hello: { platform: this.deps.platform(), agentVersion: AGENT_VERSION, nativeModule: this.deps.hasNativeModule() },
        createSocket: (url) => this.deps.createSocket(url),
        handle: (method, p) => this.handle(method, p),
        onReady: (config) => this.configure(config),
        clock: this.clock,
        log: this.log,
      });
    }
    this.client.start();
  }

  /** Registered by QuiescoRoot; changes its key so the whole app remounts (soft reset). */
  setRemount(fn: () => void): () => void {
    this.remount = fn;
    return () => {
      if (this.remount === fn) this.remount = null;
    };
  }

  unmount(): void {
    if (--this.mounted > 0) return;
    this.client?.stop();
  }

  configure(config: AgentConfig): void {
    this.config = config;
    this.network?.setIgnoreUrls(config.sync.ignoreUrls.map(toRegExp));
    this.timer?.configure({ thresholdMs: config.sync.timerThresholdMs, countIntervals: config.sync.countIntervals });
    this.frames?.setFrames(config.sync.stableFrames);
    this.engine.setEnabled(config.sync.trackers);
    this.events.setLevel(config.logLevel);
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
  };

  private timeout(opts: SyncOption): number {
    return opts.timeoutMs ?? this.config.sync.timeoutMs;
  }

  private async syncIfNeeded(opts: SyncOption, timeoutMs = this.timeout(opts)): Promise<void> {
    if (opts.sync !== false) await this.engine.waitForIdle({ timeoutMs });
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
      await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
      const found = findAll(this.adapter.getHostRoots(), matcher);
      if (found.length > 1) {
        throw new QuiescoError('MULTIPLE_MATCHES', `${found.length} elements match ${describeMatcher(matcher)}; add \`index\` or a more specific matcher`, {
          matcher,
          matches: found.map((n) => this.summarize(n)),
        });
      }
      const node = found[0];
      if (node !== undefined && isVisible(node, this.adapter.viewport())) return node;
      if (this.clock.now() >= deadline) {
        const why = node === undefined ? 'No element matches' : 'The element exists but is not visible:';
        throw new QuiescoError('ELEMENT_NOT_FOUND', `${why} ${describeMatcher(matcher)}`, { matcher });
      }
      await this.sleep(SyncDefaults.retryIntervalMs);
    }
  }

  private async action(spec: ActionSpec, mode: ParamsOf<AgentMethods['action']>['mode'], opts: SyncOption): Promise<ResultOf<AgentMethods['action']>> {
    // Device-level actions are performed by the host's DeviceProvider (adb / simctl / Playwright).
    if (spec.type === 'pressBack') return { hostInput: { kind: 'back' } };
    if (spec.type === 'openUrl') return { hostInput: { kind: 'navigate', url: spec.url } };

    if (mode === 'native') {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', `native mode for ${spec.type} needs @quiesco/native (Phase 2); set actions.mode to 'js'`, {
        action: spec.type,
        platform: this.deps.platform(),
        hint: "set actions: { mode: 'js' } in quiesco.config.ts",
      });
    }

    const timeoutMs = this.timeout(opts);
    const deadline = this.clock.now() + timeoutMs;
    const ctx = { platform: this.deps.platform() };
    let node: HostNode | undefined;

    switch (spec.type) {
      case 'dismissKeyboard':
        await this.syncIfNeeded(opts);
        this.deps.dismissKeyboard();
        break;
      case 'tap':
        js.tap((node = await this.resolveTarget(spec.matcher, opts, deadline)), ctx);
        break;
      case 'longPress':
        js.longPress((node = await this.resolveTarget(spec.matcher, opts, deadline)), ctx);
        break;
      case 'doubleTap':
        js.doubleTap((node = await this.resolveTarget(spec.matcher, opts, deadline)), ctx);
        break;
      case 'type':
        js.typeText((node = await this.resolveTarget(spec.matcher, opts, deadline)), spec.text, ctx);
        break;
      case 'clear':
        js.clearText((node = await this.resolveTarget(spec.matcher, opts, deadline)), ctx);
        break;
      case 'scroll':
        node = await this.resolveTarget(spec.matcher, opts, deadline);
        js.scrollBy(js.requireScrollable(node, 'scroll', ctx), spec.direction, spec.distance);
        break;
      case 'swipe':
        node = await this.resolveTarget(spec.matcher, opts, deadline);
        js.scrollBy(js.requireScrollable(node, 'swipe', ctx), js.swipeToScrollDirection(spec.direction));
        break;
      case 'scrollTo':
        node = await this.scrollTo(spec.container, spec.target, opts, deadline, ctx);
        break;
    }

    await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
    return node === undefined ? {} : { element: this.summarize(node) };
  }

  /**
   * Scroll `container` until `target` is visible: down until the offset stops changing, then up.
   * Each step waits for idle so lists can render more items.
   */
  private async scrollTo(container: Matcher, target: Matcher, opts: SyncOption, deadline: number, ctx: js.JsActionContext): Promise<HostNode> {
    const containerNode = await this.resolveTarget(container, opts, deadline);
    const scrollable = js.requireScrollable(containerNode, 'scrollTo', ctx);
    const directions = ['down', 'up'] as const;
    for (const direction of directions) {
      for (;;) {
        const visible = findAll(this.adapter.getHostRoots(), target).filter((n) => isVisible(n, this.adapter.viewport()));
        if (visible.length === 1) return visible[0] as HostNode;
        if (visible.length > 1) {
          throw new QuiescoError('MULTIPLE_MATCHES', `${visible.length} elements match ${describeMatcher(target)}`, { matcher: target, matches: visible.map((n) => this.summarize(n)) });
        }
        if (this.clock.now() >= deadline) break;
        const before = scrollable.offset();
        js.scrollBy(scrollable, direction);
        await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
        const after = scrollable.offset();
        if (Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1) break; // reached the end
      }
    }
    throw new QuiescoError('ELEMENT_NOT_FOUND', `Scrolled ${describeMatcher(container)} to both ends without finding a visible ${describeMatcher(target)}`, { matcher: target });
  }

  private async assert(spec: AssertionSpec, opts: SyncOption): Promise<ResultOf<AgentMethods['assert']>> {
    const timeoutMs = this.timeout(opts);
    const deadline = this.clock.now() + timeoutMs;
    for (;;) {
      await this.syncIfNeeded(opts, Math.max(1, deadline - this.clock.now()));
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
    this.frames = new FrameStableTracker({ hash: () => structureHash(this.adapter.getHostRoots()) });
    return [
      this.network,
      this.timer,
      new ReactTracker(this.adapter),
      (this.idleCallbacks = new IdleCallbackTracker({ target: this.global })),
      this.frames,
    ];
  }
}
