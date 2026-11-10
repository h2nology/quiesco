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
  ControlValue,
  Direction,
  Edge,
  ElementSummary,
  JsonValue,
  KeyName,
  ParamsOf,
  Point,
  ResultOf,
  Speed,
  TimedPoint,
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
import type { ActionOptions, CallOptions } from './options.js';
import type { VisibleOptions } from './expect.js';
import { ElementExpectation, checkRatio } from './expect.js';
import type { AgentConnection } from './server/ws-server.js';
import type { AppRunState, DeviceApi } from './device.js';
import type { SyncApi } from './sync-api.js';

export type { ActionOptions, CallOptions } from './options.js';

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
  /** What the test did to the app (Phase 6.5): calls fail fast unless it is `running`. Default: running. */
  appState?: () => AppRunState;
}

/** Calls without side effects, repeated once when the connection drops mid-call. */
const RETRYABLE: ReadonlySet<keyof AgentMethods> = new Set(['query', 'assert', 'waitForIdle', 'getTree', 'getIdleState']);

/** What an action returns when a JS dialog it opened blocks the page. */
const DIALOG: unique symbol = Symbol('dialog');

/** Extra wall-clock time on top of the agent-side timeout before the host gives up on a reply. */
const HOST_MARGIN_MS = 5_000;
/** Upper bound of steps of scrollToEdge / scrollToIndex in the agent (each may take the call timeout). */
const MAX_SCROLL_STEPS = 60;

export class Driver {
  private readonly appErrors: AgentEvents['error'][] = [];
  private appErrorListeners = new Set<(e: AgentEvents['error']) => void>();
  private watched: AgentConnection | null = null;
  private warnedJsMode = false;
  private readonly logger: Logger;
  private lifecycle: { device: DeviceApi; sync: SyncApi } | null = null;

  constructor(private readonly options: DriverOptions) {
    this.logger = options.logger ?? silentLogger;
  }

  /** `app.device.*`: relaunch, terminate, background / foreground, install, screenshots (Phase 6.5). */
  get device(): DeviceApi {
    return this.requireLifecycle().device;
  }

  /** `app.sync.*`: switch synchronization (or single trackers) off, ignore URLs / elements at runtime. */
  get sync(): SyncApi {
    return this.requireLifecycle().sync;
  }

  /** Called by the session that owns this driver. */
  setLifecycle(device: DeviceApi, sync: SyncApi): void {
    this.lifecycle = { device, sync };
  }

  private requireLifecycle(): { device: DeviceApi; sync: SyncApi } {
    if (this.lifecycle === null) throw new QuiescoError('CONFIG_ERROR', 'app.device / app.sync need a Quiesco session (createSession); this driver is attached to a running app');
    return this.lifecycle;
  }

  // ---- actions (§6.3) ----

  /** Tap the element; `point` taps that spot in the element's own coordinates (default: center). */
  tap(target: MatcherInput, opts: ActionOptions & { point?: Point } = {}): Promise<ElementSummary | undefined> {
    const spec: Extract<ActionSpec, { type: 'tap' }> = { type: 'tap', matcher: toMatcher(target) };
    if (opts.point !== undefined) spec.point = checkPoint(opts.point, 'point');
    return this.action(spec, opts);
  }
  longPress(target: MatcherInput, opts: ActionOptions & { durationMs?: number; point?: Point } = {}): Promise<ElementSummary | undefined> {
    const spec: Extract<ActionSpec, { type: 'longPress' }> = { type: 'longPress', matcher: toMatcher(target) };
    if (opts.durationMs !== undefined) spec.durationMs = opts.durationMs;
    if (opts.point !== undefined) spec.point = checkPoint(opts.point, 'point');
    return this.action(spec, opts);
  }
  doubleTap(target: MatcherInput, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    return this.action({ type: 'doubleTap', matcher: toMatcher(target) }, opts);
  }
  /** `count` taps in one gesture (iOS: increasing tap count, like a user's rapid taps). */
  multiTap(target: MatcherInput, count: number, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    if (!Number.isInteger(count) || count < 1) throw new RangeError(`count must be a positive integer, got ${count}`);
    return this.action({ type: 'multiTap', matcher: toMatcher(target), count }, opts);
  }
  type(target: MatcherInput, text: string, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    return this.action({ type: 'type', matcher: toMatcher(target), text }, opts);
  }
  /** Replace the whole text at once (no typing character by character). */
  replaceText(target: MatcherInput, text: string, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    return this.action({ type: 'replaceText', matcher: toMatcher(target), text }, opts);
  }
  clear(target: MatcherInput, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    return this.action({ type: 'clear', matcher: toMatcher(target) }, opts);
  }
  /**
   * Press `enter` (the return key: submits, or a newline in a multi-line input) or `backspace` on a
   * text field. The field only needs to exist: the key reaches it even when the keyboard's return key
   * would be out of reach.
   */
  pressKey(target: MatcherInput, key: KeyName, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    if (key !== 'enter' && key !== 'backspace') throw new RangeError(`key must be 'enter' or 'backspace', got ${String(key)}`);
    return this.action({ type: 'pressKey', matcher: toMatcher(target), key }, opts);
  }
  /** `down` reveals content below. `distance` in logical units; `from`: start point, normalized 0–1 in the element. */
  scroll(target: MatcherInput, direction: Direction, opts: ActionOptions & { distance?: number; from?: Point } = {}): Promise<ElementSummary | undefined> {
    const spec: Extract<ActionSpec, { type: 'scroll' }> = { type: 'scroll', matcher: toMatcher(target), direction };
    if (opts.distance !== undefined) spec.distance = opts.distance;
    if (opts.from !== undefined) spec.from = checkNormalized(opts.from, 'from');
    return this.action(spec, opts);
  }
  /** Scroll `container` until `target` is visible. */
  scrollTo(container: MatcherInput, target: MatcherInput, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    return this.action({ type: 'scrollTo', container: toMatcher(container), target: toMatcher(target) }, opts);
  }
  /** Scroll to the top / bottom / left / right end (a virtualized list is followed while it grows). */
  scrollToEdge(target: MatcherInput, edge: Edge, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    if (!['top', 'bottom', 'left', 'right'].includes(edge)) throw new RangeError(`edge must be top, bottom, left or right, got ${String(edge)}`);
    return this.action({ type: 'scrollToEdge', matcher: toMatcher(target), edge }, opts);
  }
  /**
   * Bring row `index` of a FlatList / FlashList into view, on every platform, also without
   * getItemLayout. `viewPosition`: 0 = top, 0.5 = middle, 1 = bottom.
   */
  scrollToIndex(list: MatcherInput, index: number, opts: ActionOptions & { viewPosition?: number } = {}): Promise<ElementSummary | undefined> {
    if (!Number.isInteger(index) || index < 0) throw new RangeError(`index must be a non-negative integer, got ${index}`);
    const spec: Extract<ActionSpec, { type: 'scrollToIndex' }> = { type: 'scrollToIndex', matcher: toMatcher(list), index };
    if (opts.viewPosition !== undefined) spec.viewPosition = checkUnit(opts.viewPosition, 'viewPosition');
    return this.action(spec, opts);
  }
  /** A finger swipe (`up` moves the finger up). `distance` in logical units; `from`: normalized start point. */
  swipe(target: MatcherInput, direction: Direction, opts: ActionOptions & { speed?: Speed; distance?: number; from?: Point } = {}): Promise<ElementSummary | undefined> {
    const spec: Extract<ActionSpec, { type: 'swipe' }> = { type: 'swipe', matcher: toMatcher(target), direction };
    if (opts.speed !== undefined) spec.speed = opts.speed;
    if (opts.distance !== undefined) spec.distance = opts.distance;
    if (opts.from !== undefined) spec.from = checkNormalized(opts.from, 'from');
    return this.action(spec, opts);
  }
  /**
   * Press and hold the element (`holdMs`, default 800: enough for long-press-activated drags), move to
   * the center of `to` (an element) or to `{ point }` (window coordinates), release.
   */
  drag(target: MatcherInput, to: MatcherInput | { point: Point }, opts: ActionOptions & { holdMs?: number; speed?: Speed } = {}): Promise<ElementSummary | undefined> {
    const dest = typeof to === 'object' && 'point' in to ? { point: checkPoint(to.point, 'point') } : { matcher: toMatcher(to) };
    const spec: Extract<ActionSpec, { type: 'drag' }> = { type: 'drag', matcher: toMatcher(target), to: dest };
    if (opts.holdMs !== undefined) spec.holdMs = opts.holdMs;
    if (opts.speed !== undefined) spec.speed = opts.speed;
    return this.action(spec, opts);
  }
  /** Tap a point of the screen (window coordinates), whatever is there (Detox `device.tap`). */
  async tapAt(point: Point, opts?: ActionOptions): Promise<void> {
    await this.action({ type: 'tapAt', point: checkPoint(point, 'point') }, opts);
  }
  async longPressAt(point: Point, opts: ActionOptions & { durationMs?: number } = {}): Promise<void> {
    const spec: Extract<ActionSpec, { type: 'longPressAt' }> = { type: 'longPressAt', point: checkPoint(point, 'point') };
    if (opts.durationMs !== undefined) spec.durationMs = opts.durationMs;
    await this.action(spec, opts);
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

  // ---- multi-finger gestures (Phase 6.4) ----

  /**
   * Two fingers on the element move apart (`scale` > 1) or together (< 1) until their distance has
   * changed by `scale`, on a line at `angle` radians (0 = horizontal). A scale that does not fit in one
   * pinch is done in several, as a user would. Needs real touches (native mode; on the web a touch viewport).
   */
  pinch(target: MatcherInput, scale: number, opts: ActionOptions & { angle?: number; speed?: Speed } = {}): Promise<ElementSummary | undefined> {
    if (!(Number.isFinite(scale) && scale > 0)) throw new RangeError(`scale must be a positive number, got ${scale}`);
    const spec: Extract<ActionSpec, { type: 'pinch' }> = { type: 'pinch', matcher: toMatcher(target), scale };
    if (opts.angle !== undefined) spec.angle = checkFinite(opts.angle, 'angle');
    if (opts.speed !== undefined) spec.speed = opts.speed;
    return this.action(spec, opts);
  }
  /** Two fingers turn `radians` around the element's center (positive: clockwise on screen). */
  rotate(target: MatcherInput, radians: number, opts: ActionOptions & { speed?: Speed } = {}): Promise<ElementSummary | undefined> {
    const spec: Extract<ActionSpec, { type: 'rotate' }> = { type: 'rotate', matcher: toMatcher(target), radians: checkFinite(radians, 'radians') };
    if (opts.speed !== undefined) spec.speed = opts.speed;
    return this.action(spec, opts);
  }
  /**
   * Any fingers along timed paths: `fingers[i]` is finger i's `{ x, y, t }` points (t in ms from the
   * start, non-decreasing); a finger is down from its first point to its last. Coordinates are the
   * element's own when `within` is given (it must be visible), else window coordinates.
   */
  async multiTouch(fingers: TimedPoint[][], opts: ActionOptions & { within?: MatcherInput } = {}): Promise<void> {
    if (!Array.isArray(fingers) || fingers.length === 0 || fingers.length > 10) throw new RangeError('fingers must hold 1 to 10 paths');
    fingers.forEach((path, i) => {
      if (!Array.isArray(path) || path.length === 0) throw new RangeError(`finger ${i} has no points`);
      path.forEach((p, k) => {
        checkPoint(p, `finger ${i} point ${k}`);
        if (!(Number.isFinite(p.t) && p.t >= 0) || (k > 0 && p.t < (path[k - 1] as TimedPoint).t)) throw new RangeError(`finger ${i}: times must be non-negative and non-decreasing`);
      });
    });
    const spec: Extract<ActionSpec, { type: 'multiTouch' }> = { type: 'multiTouch', fingers: fingers.map((f) => f.map((p) => ({ x: p.x, y: p.y, t: p.t }))) };
    if (opts.within !== undefined) spec.matcher = toMatcher(opts.within);
    await this.action(spec, opts);
  }

  // ---- value controls (Phase 6.3) ----

  /**
   * Set a value control: a slider (number), a switch / checkbox (boolean), a picker (an item's value or
   * label), a segmented control (a segment's value or index), a date / time picker or a date input
   * (Date). Real input where the control has it — a tap on a switch or segment, iOS wheels turned by a
   * finger, a browser `<select>` / date input — otherwise the component's callbacks, with the events
   * the native component sends (docs/api.md, "Value controls"). A component that renders no view of its
   * own (Android's DateTimePicker, which opens a system dialog) is found by its testID or name.
   */
  setValue(target: MatcherInput, value: number | boolean | string | Date, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    return this.action({ type: 'setValue', matcher: toMatcher(target), value: toControlValue(value) }, opts);
  }
  /**
   * Drag a slider's thumb to `position` (0 = minimum, 1 = maximum) with a real finger / mouse, then
   * (in-app native mode) read the value back and correct the drag if it missed. `js` mode sets the
   * corresponding value through the callbacks.
   */
  adjustSlider(target: MatcherInput, position: number, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    return this.action({ type: 'adjustSlider', matcher: toMatcher(target), position: checkUnit(position, 'position') }, opts);
  }
  /**
   * Perform an accessibility action the element declares (`accessibilityActions`), as a screen reader
   * does: iOS through VoiceOver's increment / decrement and custom actions, Android through
   * performAccessibilityAction; the web (no such DOM API) through onAccessibilityAction.
   */
  accessibilityAction(target: MatcherInput, name: string, opts?: ActionOptions): Promise<ElementSummary | undefined> {
    if (typeof name !== 'string' || name === '') throw new RangeError('name must be a non-empty string');
    return this.action({ type: 'accessibilityAction', matcher: toMatcher(target), name }, opts);
  }

  // ---- assertions (§6.4) ----

  /** At least one match is visible; with `ratio`, shows at least that fraction of its area. */
  expectVisible(target: MatcherInput, opts: VisibleOptions = {}): Promise<ElementSummary[]> {
    const { ratio, ...call } = opts;
    const spec: Extract<AssertionSpec, { type: 'visible' }> = { type: 'visible', matcher: toMatcher(target) };
    if (ratio !== undefined) spec.ratio = checkRatio(ratio);
    return this.assert(spec, call);
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
  expectFocused(target: MatcherInput, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'focused', matcher: toMatcher(target) }, opts);
  }
  expectNotFocused(target: MatcherInput, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'notFocused', matcher: toMatcher(target) }, opts);
  }
  expectEnabled(target: MatcherInput, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'enabled', matcher: toMatcher(target) }, opts);
  }
  expectDisabled(target: MatcherInput, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'disabled', matcher: toMatcher(target) }, opts);
  }
  expectChecked(target: MatcherInput, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'checked', matcher: toMatcher(target) }, opts);
  }
  expectNotChecked(target: MatcherInput, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'notChecked', matcher: toMatcher(target) }, opts);
  }
  /** Input text, switch state, slider / picker value or accessibilityValue equals (or matches) `expected`. */
  expectValue(target: MatcherInput, expected: JsonValue | RegExp, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'value', matcher: toMatcher(target), expected: expected instanceof RegExp ? toTextMatch(expected) : expected }, opts);
  }
  expectLabel(target: MatcherInput, expected: TextQuery, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.assert({ type: 'label', matcher: toMatcher(target), expected: toTextMatch(expected) }, opts);
  }

  /** Chained assertions: `await app.expect('save').not.toBeEnabled()` (same semantics as `expectXxx`). */
  expect(target: MatcherInput): ElementExpectation {
    return new ElementExpectation(target, (spec, opts) => this.assert(spec, opts));
  }

  /**
   * Everything known about the single matching element (Detox `getAttributes`): type, semantic type,
   * text, label, value, enabled, focused, checked, rect, visible ratio, props. Waits until the element
   * exists; MULTIPLE_MATCHES when several match.
   */
  async attributes(target: MatcherInput, opts?: CallOptions): Promise<ElementSummary> {
    const matcher = toMatcher(target);
    const found = await this.assert({ type: 'exists', matcher }, opts);
    if (found.length > 1) {
      throw new QuiescoError('MULTIPLE_MATCHES', `${found.length} elements match; add \`index\` or a more specific matcher`, { matcher, matches: found });
    }
    return found[0] as ElementSummary;
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
    // Before mode(): it reads the connection, which would wait for a terminated app to reconnect.
    this.checkAppRunning(spec.type);
    const params: ParamsOf<AgentMethods['action']> = { action: spec, mode: opts.mode ?? (await this.mode()), ...syncParams(opts) };
    // Multi-step scrolls give every step the full timeout in the agent (bounded number of steps).
    const steps = spec.type === 'scrollToEdge' || spec.type === 'scrollToIndex' ? MAX_SCROLL_STEPS : 1;
    // A JS dialog the action opens (web alert / confirm / prompt) blocks the page — its scripts, the agent
    // and Playwright's input — until the test answers it: the action is done once the dialog is up.
    const dialog = this.watchDialog();
    try {
      const r = await dialog.race(() => this.call('action', params, opts.timeoutMs, steps));
      if (r === DIALOG) return undefined;
      const input = r.hostInput;
      if (input !== undefined) {
        const inject = this.options.provider.injectInput?.bind(this.options.provider);
        if (inject === undefined) {
          throw new QuiescoError('ACTION_NOT_SUPPORTED', `${spec.type} is not supported on ${this.options.provider.platform}`, {
            action: spec.type,
            platform: this.options.provider.platform,
          });
        }
        if ((await dialog.race(() => this.race(inject(input)))) === DIALOG) return r.element;
        if (opts.sync !== false) await dialog.race(() => this.waitForIdle(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }));
      }
      return r.element;
    } finally {
      dialog.stop();
    }
  }

  /**
   * `race(start)` settles with DIALOG as soon as the page opens a JS dialog (providers that report them:
   * the web); a call that fails because the dialog is open counts as DIALOG too.
   */
  private watchDialog(): { race<T>(start: () => Promise<T>): Promise<T | typeof DIALOG>; stop(): void } {
    const subscribe = this.options.provider.onBlockingDialog?.bind(this.options.provider);
    if (subscribe === undefined) return { race: (start) => start(), stop: () => undefined };
    let open = false;
    let opened!: () => void;
    const shown = new Promise<typeof DIALOG>((resolve) => (opened = () => resolve(DIALOG)));
    const stop = subscribe(() => {
      open = true;
      opened();
    });
    return {
      race: async <T>(start: () => Promise<T>): Promise<T | typeof DIALOG> => {
        if (open) return DIALOG;
        const p = start();
        try {
          const r = await Promise.race([p, shown]);
          // The blocked call settles after the dialog is answered (or times out): nobody waits for it.
          if (r === DIALOG) p.catch(() => undefined);
          return r;
        } catch (e) {
          if (open) return DIALOG;
          throw e;
        }
      },
      stop,
    };
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

  /** `steps`: the agent may wait up to `timeoutMs` this many times (multi-step actions). */
  private async call<M extends keyof AgentMethods>(method: M, params: ParamsOf<AgentMethods[M]>, timeoutMs?: number, steps = 1): Promise<ResultOf<AgentMethods[M]>> {
    this.checkAppRunning(method);
    return this.request(method, params, timeoutMs, steps);
  }

  /**
   * Fail fast while the test has the app terminated or in the background (no waiting for a reconnect), or
   * while a web page is blocked on a JS dialog (the call would hang until the dialog is answered).
   */
  private checkAppRunning(what: string): void {
    const dialog = this.options.provider.blockingDialog?.() ?? null;
    if (dialog !== null) {
      throw new QuiescoError('DIALOG_OPEN', `${what}: the page is showing a dialog (${JSON.stringify(dialog)}); answer it first, e.g. app.device.system.tap({ text: 'OK' }) or { text: 'Cancel' }`, {
        method: what,
        message: dialog,
      });
    }
    const state = this.options.appState?.() ?? 'running';
    if (state === 'terminated') {
      throw new QuiescoError('APP_NOT_RUNNING', `${what}: the app is not running (the test terminated or uninstalled it); call app.device.relaunch() first`, { method: what });
    }
    if (state === 'background') {
      throw new QuiescoError('APP_IN_BACKGROUND', `${what}: the app is in the background; call app.device.bringToForeground() first`, { method: what });
    }
  }

  /**
   * An agent call without the app-state check (the session's lifecycle steps: AppState polling while in
   * the background, suspend, configure). Not part of the test API.
   */
  async request<M extends keyof AgentMethods>(method: M, params: ParamsOf<AgentMethods[M]>, timeoutMs?: number, steps = 1): Promise<ResultOf<AgentMethods[M]>> {
    const pending = this.takeAppError();
    if (pending !== null) throw pending;
    const send = async (): Promise<ResultOf<AgentMethods[M]>> => {
      const conn = await this.options.connection();
      this.attach(conn);
      return this.race(conn.request(method, params, (timeoutMs ?? this.options.defaultTimeoutMs) * steps + HOST_MARGIN_MS));
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

function checkPoint(p: Point, name: string): Point {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new RangeError(`${name} must have finite x and y, got ${JSON.stringify(p)}`);
  return { x: p.x, y: p.y };
}

/** A setValue argument in JSON: dates as ISO strings. */
export function toControlValue(v: number | boolean | string | Date): ControlValue {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new RangeError('setValue got an invalid Date');
    return { date: v.toISOString() };
  }
  if (typeof v === 'number' && !Number.isFinite(v)) throw new RangeError(`setValue got ${v}`);
  if (typeof v !== 'number' && typeof v !== 'boolean' && typeof v !== 'string') throw new RangeError(`setValue takes a number, boolean, string or Date, got ${typeof v}`);
  return v;
}

function checkFinite(v: number, name: string): number {
  if (!Number.isFinite(v)) throw new RangeError(`${name} must be a finite number, got ${v}`);
  return v;
}

function checkUnit(v: number, name: string): number {
  if (!(v >= 0 && v <= 1)) throw new RangeError(`${name} must be between 0 and 1, got ${v}`);
  return v;
}

/** A point normalized to the element: both coordinates in [0, 1]. */
function checkNormalized(p: Point, name: string): Point {
  return { x: checkUnit(p.x, `${name}.x`), y: checkUnit(p.y, `${name}.y`) };
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
