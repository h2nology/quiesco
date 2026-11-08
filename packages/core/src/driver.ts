/**
 * Driver: the async API of requirements.md §6.3–6.6, used as `this.app` in step definitions.
 * Every call goes to the agent, which syncs (waits for idle) around it. If the app reports an uncaught
 * error, the current call fails immediately with APP_ERROR (§7).
 */
import type {
  ActionMode,
  ActionSpec,
  AgentEvents,
  AgentMethods,
  AssertionSpec,
  Direction,
  ElementSummary,
  JsonValue,
  ParamsOf,
  ResultOf,
  Speed,
  TrackerState,
  TreeNode,
} from '@quiesco/protocol';

import { QuiescoError } from './errors.js';
import { findNonJson } from './json.js';
import type { Logger } from './logger.js';
import { silentLogger } from './logger.js';
import type { MatcherInput, TextQuery } from './matcher.js';
import { toMatcher, toTextMatch } from './matcher.js';
import type { DeviceProvider } from './devices/provider.js';
import type { AgentConnection } from './server/ws-server.js';

export interface CallOptions {
  /** Per-call timeout (agent side). Default: `sync.timeoutMs`. */
  timeoutMs?: number;
  /** `false` skips waiting for idle around this call (infinite animations etc.). */
  sync?: boolean;
}

export interface ActionOptions extends CallOptions {
  mode?: ActionMode;
}

export interface DriverOptions {
  provider: DeviceProvider;
  /**
   * Current connection. Changes after a hard reset or a web page reload; when the app is reconnecting,
   * resolves with the new connection.
   */
  connection: () => Promise<AgentConnection>;
  defaultTimeoutMs: number;
  /** Configured action mode; undefined = native if the app has @quiesco/native, else js. */
  mode?: ActionMode;
  /** App errors (by message) that are logged instead of failing the call. */
  ignoreAppErrors?: readonly RegExp[];
  logger?: Logger;
}

/** Calls without side effects, repeated once when the connection drops mid-call. */
const RETRYABLE: ReadonlySet<keyof AgentMethods> = new Set(['query', 'assert', 'waitForIdle', 'getTree', 'getIdleState']);

/** Extra wall-clock time on top of the agent-side timeout before the host gives up on a reply. */
const HOST_MARGIN_MS = 5_000;

export class Driver {
  private readonly appErrors: AgentEvents['error'][] = [];
  private appErrorListeners = new Set<(e: AgentEvents['error']) => void>();
  private watched: AgentConnection | null = null;
  private warnedJsMode = false;
  private readonly logger: Logger;

  constructor(private readonly options: DriverOptions) {
    this.logger = options.logger ?? silentLogger;
  }

  // ---- actions (§6.3) ----

  tap(target: MatcherInput, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    return this.action({ type: 'tap', matcher: toMatcher(target) }, opts);
  }
  longPress(target: MatcherInput, opts: ActionOptions & { durationMs?: number } = {}): Promise<ElementSummary | undefined> {
    const spec: ActionSpec = { type: 'longPress', matcher: toMatcher(target) };
    if (opts.durationMs !== undefined) spec.durationMs = opts.durationMs;
    return this.action(spec, opts);
  }
  doubleTap(target: MatcherInput, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    return this.action({ type: 'doubleTap', matcher: toMatcher(target) }, opts);
  }
  type(target: MatcherInput, text: string, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    return this.action({ type: 'type', matcher: toMatcher(target), text }, opts);
  }
  clear(target: MatcherInput, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    return this.action({ type: 'clear', matcher: toMatcher(target) }, opts);
  }
  scroll(target: MatcherInput, direction: Direction, opts: ActionOptions & { distance?: number } = {}): Promise<ElementSummary | undefined> {
    const spec: ActionSpec = { type: 'scroll', matcher: toMatcher(target), direction };
    if (opts.distance !== undefined) spec.distance = opts.distance;
    return this.action(spec, opts);
  }
  scrollTo(container: MatcherInput, target: MatcherInput, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    return this.action({ type: 'scrollTo', container: toMatcher(container), target: toMatcher(target) }, opts);
  }
  swipe(target: MatcherInput, direction: Direction, opts: ActionOptions & { speed?: Speed } = {}): Promise<ElementSummary | undefined> {
    const spec: ActionSpec = { type: 'swipe', matcher: toMatcher(target), direction };
    if (opts.speed !== undefined) spec.speed = opts.speed;
    return this.action(spec, opts);
  }
  async pressBack(opts?: ActionOptions): Promise<void> {
    await this.action({ type: 'pressBack' }, opts);
  }
  async openUrl(url: string, opts?: ActionOptions): Promise<void> {
    await this.action({ type: 'openUrl', url }, opts);
  }
  async dismissKeyboard(opts?: ActionOptions): Promise<void> {
    await this.action({ type: 'dismissKeyboard' }, opts);
  }

  // ---- assertions (§6.4) ----

  expectVisible(target: MatcherInput, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'visible', matcher: toMatcher(target) }, opts);
  }
  expectNotVisible(target: MatcherInput, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'notVisible', matcher: toMatcher(target) }, opts);
  }
  expectExists(target: MatcherInput, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'exists', matcher: toMatcher(target) }, opts);
  }
  expectNotExists(target: MatcherInput, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'notExists', matcher: toMatcher(target) }, opts);
  }
  expectText(target: MatcherInput, expected: TextQuery, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'text', matcher: toMatcher(target), expected: toTextMatch(expected) }, opts);
  }
  expectProp(target: MatcherInput, prop: string, expected: JsonValue, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'prop', matcher: toMatcher(target), prop, expected }, opts);
  }
  expectCount(target: MatcherInput, expected: number, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'count', matcher: toMatcher(target), expected }, opts);
  }

  // ---- queries, sync, backdoors, reset (§6.1, §6.2, §6.5, §6.6) ----

  async query(target: MatcherInput, opts: CallOptions = {}): Promise<ElementSummary[]> {
    const r = await this.call('query', { matcher: toMatcher(target), ...syncParams(opts) }, opts.timeoutMs);
    return r.elements;
  }

  async getTree(): Promise<TreeNode | null> {
    return (await this.call('getTree', {})).root;
  }

  async waitForIdle(opts: { timeoutMs?: number } = {}): Promise<number> {
    const params = opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs };
    return (await this.call('waitForIdle', params, opts.timeoutMs)).waitedMs;
  }

  async getIdleState(): Promise<TrackerState[]> {
    return (await this.call('getIdleState', {})).trackers;
  }

  async backdoor<T extends JsonValue = JsonValue>(name: string, ...args: JsonValue[]): Promise<T> {
    const bad = findNonJson(args, '$args');
    if (bad !== null) {
      throw new QuiescoError('NOT_SERIALIZABLE', `Backdoor "${name}" argument at ${bad.path} is not JSON (${bad.reason})`, { where: 'args', path: bad.path });
    }
    return (await this.call('backdoor', { name, args })).value as T;
  }

  /** Soft reset (storage, onReset hooks, remount, wait for idle). Returns its duration in ms. */
  async reset(): Promise<number> {
    return (await this.call('reset', {})).durationMs;
  }

  /** Take an app error reported between calls (the runner may fail the scenario with it). */
  takeAppError(): QuiescoError | null {
    const e = this.appErrors.shift();
    return e === undefined ? null : appError(e);
  }

  // ---- internals ----

  private async action(spec: ActionSpec, opts: ActionOptions = {}): Promise<ElementSummary | undefined> {
    const params: ParamsOf<AgentMethods['action']> = { action: spec, mode: opts.mode ?? (await this.mode()), ...syncParams(opts) };
    const r = await this.call('action', params, opts.timeoutMs);
    if (r.hostInput !== undefined) {
      const inject = this.options.provider.injectInput?.bind(this.options.provider);
      if (inject === undefined) {
        throw new QuiescoError('ACTION_NOT_SUPPORTED', `${spec.type} is not supported on ${this.options.provider.platform}`, {
          action: spec.type,
          platform: this.options.provider.platform,
        });
      }
      await this.race(inject(r.hostInput));
      if (opts.sync !== false) await this.waitForIdle(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs });
    }
    return r.element;
  }

  private async assert(spec: AssertionSpec, opts: CallOptions = {}): Promise<ElementSummary[]> {
    return (await this.call('assert', { assertion: spec, ...syncParams(opts) }, opts.timeoutMs)).elements;
  }

  /**
   * Configured mode, else `native` when the app has @quiesco/native or the device injects real input
   * itself (web), else `js`.
   */
  private async mode(): Promise<ActionMode> {
    if (this.options.mode !== undefined) return this.options.mode;
    const native = (await this.options.connection()).info.nativeModule || this.options.provider.platform === 'web';
    if (!native && !this.warnedJsMode) {
      this.warnedJsMode = true;
      this.logger.info('@quiesco/native is not in the app: actions use js mode (callbacks are called directly, no hit testing)');
    }
    return native ? 'native' : 'js';
  }

  private async call<M extends keyof AgentMethods>(method: M, params: ParamsOf<AgentMethods[M]>, timeoutMs?: number): Promise<ResultOf<AgentMethods[M]>> {
    const pending = this.takeAppError();
    if (pending !== null) throw pending;
    const send = async (): Promise<ResultOf<AgentMethods[M]>> => {
      const conn = await this.options.connection();
      this.attach(conn);
      return this.race(conn.request(method, params, (timeoutMs ?? this.options.defaultTimeoutMs) + HOST_MARGIN_MS));
    };
    try {
      return await send();
    } catch (e) {
      // A page reload / relaunch dropped the connection mid-call: read-only calls are safe to repeat
      // once the app is back (requirements.md §6.2: reconnecting is not an error).
      if (e instanceof QuiescoError && e.errorName === 'AGENT_DISCONNECTED' && RETRYABLE.has(method)) return send();
      throw e;
    }
  }

  /** Fail as soon as the app reports an uncaught error. */
  private race<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onError = (e: AgentEvents['error']): void => {
        const i = this.appErrors.indexOf(e);
        if (i >= 0) this.appErrors.splice(i, 1);
        reject(appError(e));
      };
      this.appErrorListeners.add(onError);
      p.then(resolve, reject).finally(() => this.appErrorListeners.delete(onError));
    });
  }

  /** Start collecting app errors from `conn` (called by the session as soon as the app connects). */
  attach(conn: AgentConnection): void {
    if (this.watched === conn) return;
    this.watched = conn;
    conn.on('appError', (e) => {
      if (this.watched !== conn) return;
      if (this.options.ignoreAppErrors?.some((re) => re.test(e.message)) === true) {
        this.logger.warn(`ignored app error (${e.kind}): ${e.message}`);
        return;
      }
      this.appErrors.push(e);
      for (const l of [...this.appErrorListeners]) l(e);
    });
  }
}

function syncParams(opts: CallOptions): { sync?: boolean; timeoutMs?: number } {
  const out: { sync?: boolean; timeoutMs?: number } = {};
  if (opts.sync !== undefined) out.sync = opts.sync;
  if (opts.timeoutMs !== undefined) out.timeoutMs = opts.timeoutMs;
  return out;
}

function appError(e: AgentEvents['error']): QuiescoError {
  const data: Record<string, unknown> = { message: e.message, kind: e.kind };
  if (e.stack !== undefined) data['stack'] = e.stack;
  return new QuiescoError('APP_ERROR', `The app threw (${e.kind}): ${e.message}`, data);
}
