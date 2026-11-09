/**
 * `native` action mode (requirements.md §6.3): real input through @quiesco/native, so hit testing,
 * gesture handlers, pressed states and focus behave as for a user.
 *
 * Before touching an element:
 * 1. its native view must stay at the same place for two consecutive checks, and the native side must
 *    not report it as settling (iOS: a view controller transition such as a Modal fading in drops
 *    touches without moving the view);
 * 2. its window must have the input focus (otherwise e.g. a Modal is on top) → ELEMENT_OBSCURED;
 * 3. within the window, the topmost element at its center must be the element or a descendant
 *    (elements with pointerEvents none / box-none are transparent) → ELEMENT_OBSCURED.
 * The touch point itself is computed natively from the view (docs/spikes, Phase 2.0 findings).
 */
import type { ActionType, Direction, KeyName, Matcher, Point, Rect, Speed } from '@quiesco/protocol';

import { QuiescoError } from '../errors';
import type { HostNode, Viewport } from '../fiber-adapter';
import { describeMatcher, summarize } from '../query';
import type { Clock } from '../sync';
import { center, describe, hitTest, isAncestor } from './hit-test';
import type { ActionPerformer } from './performer';
import * as value from './value';
import type { WheelContext, WheelState } from './wheel';
import { selectDate, selectRow } from './wheel';

/** The parts of @quiesco/native used here (see packages/native/src/index.ts). */
export interface NativeBridge {
  locate(tag: number): Promise<{
    found: boolean;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    windowHasFocus?: boolean;
    /** iOS: a view controller transition or a Core Animation is running; touches may be dropped. */
    settling?: boolean;
    /** iOS: class of the native view a touch at the center would reach. */
    hitClass?: string;
    /** iOS: tags of the hit view and its superviews (React tags on Fabric component views). */
    hitTags?: number[];
  }>;
  /** iOS: reach information for a window point of `tag`'s window (taps at a point). */
  hitAt?(tag: number, x: number, y: number): Promise<{ windowHasFocus?: boolean; hitClass?: string; hitTags?: number[] }>;
  tap(tag: number, x: number, y: number, holdMs: number, count: number): Promise<{ handled: boolean }>;
  swipe(tag: number, fromX: number, fromY: number, toX: number, toY: number, durationMs: number): Promise<{ handled: boolean }>;
  typeText(tag: number, text: string, replace: boolean): Promise<{ text: string }>;
  /** One finger along a timed path, flat [x, y, tMs, ...] in the window of `tag`. Absent in apps built before Phase 6.2. */
  gesture?(tag: number, path: number[]): Promise<{ handled: boolean }>;
  /** Absent in apps built before Phase 6.2. */
  pressKey?(tag: number, key: KeyName): Promise<{ text: string }>;
  /** Present when the module can open a URL inside the app (iOS: no system confirmation alert). */
  openUrl?(url: string): Promise<{ opened: boolean }>;
  /** iOS: native UI settling, sampled every frame (see sync/native-settle.ts). */
  idleState?(): { settling: boolean; reasons: string[] };
  /** Slider geometry (window x of the thumb at min / max, current thumb). Absent before Phase 6.3. */
  sliderInfo?(tag: number): Promise<{ found: boolean; minX?: number; maxX?: number; thumbX?: number; y?: number; value?: number; minimum?: number; maximum?: number }>;
  /** iOS only: wheel picker state (columns, selection, date). Absent before Phase 6.3 and on Android. */
  wheelInfo?(tag: number): Promise<WheelState>;
  /** Perform a declared accessibility action as a screen reader does. Absent before Phase 6.3. */
  accessibilityAction?(tag: number, name: string, label: string, index: number, customIndex: number): Promise<{ performed: boolean; via: string }>;
}

export interface NativeContext {
  bridge: NativeBridge;
  clock: Clock;
  roots: () => readonly HostNode[];
  viewport: () => Viewport | null;
  /** The current action and its matcher, for error data. */
  action: ActionType;
  matcher: Matcher;
  deadline: number;
}

const TAP_HOLD_MS = 50;
const LONG_PRESS_MS = 800;
const STABLE_POLL_MS = 16;
const SWIPE_MS: Record<Speed, number> = { slow: 600, normal: 300, fast: 120 };
/** Slow drag for scrolling: no fling, so the content moves by about the drag distance. */
const SCROLL_DRAG_MS = 500;
const DRAG_FRACTION = 0.35;
/** Rest at the drop point before releasing, so drop targets see the finger arrive. */
const DROP_HOLD_MS = 100;
/** Press on the slider thumb before moving, so the slider (not a scroll view) takes the drag. */
const SLIDER_PRESS_MS = 80;
/** Every slider drag ends with a straight move of this length onto the aim (beyond the touch slop). */
const SLIDER_RUN_UP = 80;

/** The current @quiesco/native lacks `fn` (the app was built before it existed). */
function needsRebuild(fn: string, action: ActionType): QuiescoError {
  return new QuiescoError('ACTION_NOT_SUPPORTED', `${action} needs @quiesco/native's ${fn}(), which the installed app does not have`, {
    action,
    platform: 'native',
    hint: 'rebuild the app (e2e build) with the current @quiesco/native, or pass { mode: "js" } to this call',
  });
}

export { center, describe, hitTest, isAncestor } from './hit-test';

function tagOf(node: HostNode, action: ActionType, matcher: Matcher): number {
  const tag = node.nativeTag();
  if (tag === null) {
    throw new QuiescoError('ACTION_NOT_SUPPORTED', 'native mode cannot address this element (no native view tag)', {
      action,
      platform: 'native',
      hint: `element ${JSON.stringify(matcher)} has no native view; use mode 'js' for this call`,
    });
  }
  return tag;
}

/**
 * Rejections of @quiesco/native (its NativeErrorCode) as Quiesco errors; anything else unchanged.
 */
export function fromNativeError(e: unknown, call: string, action: ActionType, matcher: Matcher): unknown {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  const message = e instanceof Error ? e.message : String(e);
  switch (code) {
    case 'E_UNSUPPORTED':
      return new QuiescoError('ACTION_NOT_SUPPORTED', message, {
        action,
        platform: 'native',
        hint: "real touch injection is not available on this OS version; set actions.mode to 'js' (or pass { mode: 'js' } to this call)",
      });
    case 'E_NO_VIEW':
      return new QuiescoError('ELEMENT_NOT_FOUND', `The element's native view disappeared during ${action} (native ${call}; unmounted?)`, { matcher });
    case 'E_NOT_TEXT_INPUT':
      return new QuiescoError('ACTION_NOT_SUPPORTED', `${describeMatcher(matcher)} is not a text field: ${message}`, { action, platform: 'native' });
    case 'E_NO_ACTION':
      return new QuiescoError('ACTION_NOT_SUPPORTED', `${describeMatcher(matcher)}: ${message}`, { action, platform: 'native' });
    default:
      return e;
  }
}

/** The bridge with rejections mapped by {@link fromNativeError}. */
function guarded(bridge: NativeBridge, action: ActionType, matcher: Matcher): NativeBridge {
  const wrap =
    <A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>) =>
    (...a: A): Promise<R> =>
      fn(...a).catch((e: unknown) => {
        throw fromNativeError(e, name, action, matcher);
      });
  return {
    locate: wrap('locate', bridge.locate.bind(bridge)),
    ...(bridge.hitAt !== undefined ? { hitAt: wrap('hitAt', bridge.hitAt.bind(bridge)) } : {}),
    tap: wrap('tap', bridge.tap.bind(bridge)),
    swipe: wrap('swipe', bridge.swipe.bind(bridge)),
    typeText: wrap('typeText', bridge.typeText.bind(bridge)),
    ...(bridge.gesture !== undefined ? { gesture: wrap('gesture', bridge.gesture.bind(bridge)) } : {}),
    ...(bridge.pressKey !== undefined ? { pressKey: wrap('pressKey', bridge.pressKey.bind(bridge)) } : {}),
    ...(bridge.sliderInfo !== undefined ? { sliderInfo: wrap('sliderInfo', bridge.sliderInfo.bind(bridge)) } : {}),
    ...(bridge.wheelInfo !== undefined ? { wheelInfo: wrap('wheelInfo', bridge.wheelInfo.bind(bridge)) } : {}),
    ...(bridge.accessibilityAction !== undefined ? { accessibilityAction: wrap('accessibilityAction', bridge.accessibilityAction.bind(bridge)) } : {}),
  };
}

export function nativePerformer(ctx: NativeContext): ActionPerformer {
  const { clock } = ctx;
  const bridge = guarded(ctx.bridge, ctx.action, ctx.matcher);
  const sleep = (ms: number): Promise<void> =>
    new Promise((r) => {
      clock.setTimeout(r, ms);
    });

  /**
   * Wait until the native view stops moving, then check it can receive the touch at `point` (element
   * coordinates; default: its center).
   */
  const ready = async (node: HostNode, point?: Point): Promise<{ tag: number; rect: Rect }> => {
    const tag = tagOf(node, ctx.action, ctx.matcher);
    let prev: Rect | null = null;
    for (;;) {
      const loc = await bridge.locate(tag);
      if (!loc.found || loc.x === undefined || loc.y === undefined || loc.width === undefined || loc.height === undefined) {
        // Rendered by React but not (yet) in a window, e.g. the content of a Modal being presented.
        if (clock.now() < ctx.deadline) {
          prev = null;
          await sleep(STABLE_POLL_MS);
          continue;
        }
        throw new QuiescoError('ELEMENT_NOT_FOUND', 'The element has no native view in a window (unmounted?)', { matcher: ctx.matcher });
      }
      const rect = { x: loc.x, y: loc.y, width: loc.width, height: loc.height };
      const same = loc.settling !== true && prev !== null && Math.abs(prev.x - rect.x) < 0.5 && Math.abs(prev.y - rect.y) < 0.5 && Math.abs(prev.width - rect.width) < 0.5;
      if (same || clock.now() >= ctx.deadline) {
        const reach = point !== undefined && bridge.hitAt !== undefined ? await bridge.hitAt(tag, rect.x + point.x, rect.y + point.y) : loc;
        if (reach.windowHasFocus === false && !hitInside(node, reach.hitTags)) {
          const what = reach.hitClass !== undefined && reach.hitClass !== '' ? ` (the touch would reach ${reach.hitClass})` : '';
          throw obscured(node, `another window or native view, e.g. a Modal, dialog or navigation bar${what}`, { ...loc, ...reach });
        }
        const js = node.measure() ?? rect;
        const top = hitTest(ctx.roots(), point === undefined ? center(js) : { x: js.x + point.x, y: js.y + point.y });
        if (top !== null && !isAncestor(node, top)) throw obscured(node, describe(top));
        return { tag, rect };
      }
      prev = rect;
      await sleep(STABLE_POLL_MS);
    }
  };

  /**
   * Whether the native hit (iOS `hitTags`, from the hit view up) lands in `node`'s React subtree: the
   * first tag that belongs to a React host must be the node or one of its descendants. Fabric mounts
   * some React children outside their React parent's native view, so native ancestry alone is wrong.
   */
  const hitInside = (node: HostNode, hitTags: number[] | undefined): boolean => {
    if (hitTags === undefined) return false;
    const inside = new Set<number>();
    const collect = (n: HostNode, into: Set<number>): void => {
      const t = n.nativeTag();
      if (t !== null) into.add(t);
      for (const c of n.children) collect(c, into);
    };
    collect(node, inside);
    const known = new Set<number>();
    for (const r of ctx.roots()) collect(r, known);
    const first = hitTags.find((t) => known.has(t));
    return first !== undefined && inside.has(first);
  };

  const obscured = (node: HostNode, by: string, native?: Record<string, unknown>): QuiescoError =>
    new QuiescoError('ELEMENT_OBSCURED', `${describe(node)} is covered by ${by}; a real touch would not reach it`, {
      matcher: ctx.matcher,
      element: summarize(node, ctx.viewport()),
      obscuredBy: by,
      ...(native !== undefined ? { native } : {}),
    });

  /**
   * Finger drag inside the element, in its window coordinates. Without `from` it runs through the
   * center; with `from` (normalized 0–1) it starts there and travels `distance` (default: about 70% of
   * the element) in the finger direction.
   */
  const drag = async (node: HostNode, finger: Direction, durationMs: number, distance?: number, from?: Point): Promise<void> => {
    const { tag, rect } = await ready(node);
    const vertical = finger === 'up' || finger === 'down';
    const span = vertical ? rect.height : rect.width;
    const sign = finger === 'down' || finger === 'right' ? 1 : -1;
    let start: Point;
    let end: Point;
    if (from === undefined) {
      const c = center(rect);
      const half = Math.min((distance ?? span * DRAG_FRACTION * 2) / 2, span * 0.45);
      start = vertical ? { x: c.x, y: c.y - sign * half } : { x: c.x - sign * half, y: c.y };
      end = vertical ? { x: c.x, y: c.y + sign * half } : { x: c.x + sign * half, y: c.y };
    } else {
      start = { x: rect.x + from.x * rect.width, y: rect.y + from.y * rect.height };
      const d = distance ?? span * DRAG_FRACTION * 2;
      end = vertical ? { x: start.x, y: start.y + sign * d } : { x: start.x + sign * d, y: start.y };
    }
    await bridge.swipe(tag, start.x, start.y, end.x, end.y, durationMs);
  };

  /** A one-finger timed path; points are window coordinates. */
  const gesture = async (tag: number, path: [Point, number][]): Promise<void> => {
    if (bridge.gesture === undefined) throw needsRebuild('gesture', ctx.action);
    await bridge.gesture(tag, path.flatMap(([p, t]) => [p.x, p.y, t]));
  };

  /** Hold at an element-relative point for `holdMs` (a tap or a long press there). */
  const pressAt = async (node: HostNode, point: Point, holdMs: number): Promise<void> => {
    const { tag, rect } = await ready(node, point);
    const p = { x: rect.x + point.x, y: rect.y + point.y };
    await gesture(tag, [
      [p, 0],
      [p, holdMs],
    ]);
  };

  /** Content direction → finger direction (scroll down = finger moves up). */
  const fingerFor = (content: Direction): Direction => ({ up: 'down', down: 'up', left: 'right', right: 'left' } as const)[content];

  return {
    viaHost: false,
    async tap(node, point) {
      if (point !== undefined) return pressAt(node, point, TAP_HOLD_MS);
      const { tag } = await ready(node);
      await bridge.tap(tag, 0, 0, TAP_HOLD_MS, 1);
    },
    async longPress(node, durationMs, point) {
      if (point !== undefined) return pressAt(node, point, durationMs ?? LONG_PRESS_MS);
      const { tag } = await ready(node);
      await bridge.tap(tag, 0, 0, durationMs ?? LONG_PRESS_MS, 1);
    },
    async multiTap(node, count) {
      const { tag } = await ready(node);
      await bridge.tap(tag, 0, 0, TAP_HOLD_MS, count);
    },
    async type(node, text) {
      const { tag } = await ready(node);
      await bridge.tap(tag, 0, 0, TAP_HOLD_MS, 1); // focus, like a user
      await bridge.typeText(tag, text, false);
    },
    async replaceText(node, text) {
      const { tag } = await ready(node);
      await bridge.tap(tag, 0, 0, TAP_HOLD_MS, 1);
      await bridge.typeText(tag, text, true);
    },
    async clear(node) {
      const { tag } = await ready(node);
      await bridge.tap(tag, 0, 0, TAP_HOLD_MS, 1);
      await bridge.typeText(tag, '', true);
    },
    async pressKey(node, key) {
      if (bridge.pressKey === undefined) throw needsRebuild('pressKey', ctx.action);
      // The key goes to the field; it does not need to be visible or tapped (Detox #4546: the return
      // key of the keyboard can be out of reach).
      await bridge.pressKey(tagOf(node, ctx.action, ctx.matcher), key);
    },
    scroll: (node, direction, distance, from) => drag(node, fingerFor(direction), SCROLL_DRAG_MS, distance, from),
    swipe: (node, direction, speed, distance, from) => drag(node, direction, SWIPE_MS[speed ?? 'normal'], distance, from),
    async drag(node, to, holdMs, durationMs) {
      const { tag, rect } = await ready(node);
      const from = center(rect);
      await gesture(tag, [
        [from, 0],
        [from, holdMs],
        [to, holdMs + durationMs],
        [to, holdMs + durationMs + DROP_HOLD_MS],
      ]);
    },
    async tapAt(point, holdMs) {
      await bridge.tap(-1, point.x, point.y, holdMs ?? TAP_HOLD_MS, 1);
    },

    /**
     * Real input where the control has it: a switch is tapped (when it must change), a segment is
     * tapped, an iOS wheel (Picker, DatePicker in wheels style) is turned. Sliders get their exact
     * value through their callbacks (a drag lands on a pixel, not a value: use adjustSlider for a real
     * drag); Android's picker dialogs / date dialogs, iOS compact / inline date pickers and components
     * without a native view are set through their callbacks too (docs/api.md, value controls).
     */
    async setValue(control, v) {
      const node = control.node;
      const viaCallbacks = (): void => value.jsSetValue(control, v, 'native');
      if (node === null || node.nativeTag() === null || value.isDisabledControl(control)) return viaCallbacks();
      switch (control.kind) {
        case 'switch':
          if (typeof v !== 'boolean' || value.switchState(control) === v) return viaCallbacks();
          return this.tap(node);
        case 'segmented': {
          const i = value.segmentIndex(control, v, 'native');
          const n = value.segmentValues(control).length;
          const r = node.measure();
          if (i === control.props['selectedIndex'] || r === null || n === 0) return viaCallbacks();
          return pressAt(node, { x: ((i + 0.5) * r.width) / n, y: r.height / 2 }, TAP_HOLD_MS);
        }
        case 'picker':
        case 'date': {
          if (bridge.wheelInfo === undefined) return viaCallbacks();
          const { tag } = await ready(node);
          const wheels = wheelContext(tag);
          if (!(await wheels.read()).found) return viaCallbacks();
          if (control.kind === 'picker') {
            await selectRow(wheels, 0, value.pickerIndex(control, v, 'native'));
          } else {
            const d = value.toDate(v, 'native');
            value.checkDate(control.props, d, 'native');
            await selectDate(wheels, d);
          }
          return;
        }
        default:
          return viaCallbacks();
      }
    },

    /** A real drag of the thumb, then the slider's value is read back (a drag lands on a pixel). */
    async adjustSlider(node, control, position) {
      if (bridge.sliderInfo === undefined) throw needsRebuild('sliderInfo', ctx.action);
      const sliderInfo = bridge.sliderInfo;
      const { tag } = await ready(node);
      const range = value.sliderRange(control.props);
      const expected = value.sliderValueAt(range, position);
      const span = range.max - range.min;
      const want = span === 0 ? 0 : (expected - range.min) / span;
      // Native sliders keep their own units (Android: SeekBar progress steps): compare positions.
      // A finger lands on a point, not a value: within one step (1% of a continuous slider) of the
      // position. setValue sets an exact value.
      const tolerance = span > 0 && range.step > 0 ? range.step / span + 1e-6 : 0.01;
      const ratio = (i: { value?: number; minimum?: number; maximum?: number }): number | null =>
        i.value === undefined || i.minimum === undefined || i.maximum === undefined || i.maximum === i.minimum ? null : (i.value - i.minimum) / (i.maximum - i.minimum);
      let info = await sliderInfo(tag);
      const valid = (i: typeof info): i is Required<typeof info> =>
        i.found && i.minX !== undefined && i.maxX !== undefined && i.thumbX !== undefined && i.y !== undefined;
      /** Drag the thumb straight to window x `x`, then read until the native value stops changing. */
      const dragTo = async (x: number): Promise<void> => {
        if (!valid(info)) return;
        const from = { x: info.thumbX, y: info.y };
        const to = { x, y: info.y };
        const moveMs = 150 + Math.abs(to.x - from.x) * 2;
        await gesture(tag, [
          [from, 0],
          [from, SLIDER_PRESS_MS],
          [to, SLIDER_PRESS_MS + moveMs],
          [to, SLIDER_PRESS_MS + moveMs + DROP_HOLD_MS],
        ]);
        let prev: number | undefined;
        for (;;) {
          info = await sliderInfo(tag);
          if (info.value === prev || clock.now() >= ctx.deadline) break;
          prev = info.value;
          await sleep(STABLE_POLL_MS * 2);
        }
      };
      // The thumb moves with the finger, minus the touch slop at the start of a drag (measured on iOS
      // 27: ~9 pt; a drag that reverses loses much more). So every drag goes one way, at least
      // SLIDER_RUN_UP long (a separate drag away from the target first when it is closer), and the slop
      // read back after a drag is added to the next one.
      let slop = 0;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (!valid(info)) {
          throw new QuiescoError('ACTION_NOT_SUPPORTED', `${describe(node)} has no native slider to drag`, { action: 'adjustSlider', platform: 'native', hint: 'pass { mode: "js" }' });
        }
        const r0 = ratio(info);
        if (attempt > 0 && r0 !== null && Math.abs(r0 - want) <= tolerance) return;
        const target = info.minX + position * (info.maxX - info.minX);
        if (Math.abs(target - info.thumbX) < SLIDER_RUN_UP) {
          let away = target >= info.thumbX ? -1 : 1;
          const out = target + away * SLIDER_RUN_UP * 1.5;
          if (out < info.minX || out > info.maxX) away = -away;
          await dragTo(target + away * SLIDER_RUN_UP * 1.5);
          if (!valid(info)) continue;
        }
        const dir = Math.sign(target - info.thumbX) || 1;
        await dragTo(target + dir * slop);
        const r = ratio(info);
        if (r !== null && valid(info)) slop += (want - r) * (info.maxX - info.minX) * dir;
      }
      const r = ratio(info);
      if (r !== null && Math.abs(r - want) <= tolerance) return;
      throw new QuiescoError('ACTION_NOT_SUPPORTED', `adjustSlider(${position}) left the slider at ${r === null ? '?' : r.toFixed(3)} of its range (wanted ${want.toFixed(3)})`, {
        action: 'adjustSlider',
        platform: 'native',
        hint: 'the thumb did not follow the drag; check that nothing covers the slider, or pass { mode: "js" }',
      });
    },

    /** As a screen reader does (iOS: increment / decrement / custom actions; Android: performAccessibilityAction). */
    async accessibilityAction(target, name) {
      const declared = value.declaredAction(target, name, 'native');
      const tag = target.host?.nativeTag() ?? null;
      if (tag === null) return value.jsAccessibilityAction(target, name, 'native');
      if (bridge.accessibilityAction === undefined) throw needsRebuild('accessibilityAction', ctx.action);
      // The native "performed" flag is not reliable (Android's RN delegate dispatches increment /
      // decrement and then returns View's default, false), so the handler is checked here instead.
      if (target.handler === null) {
        throw value.unsupported('accessibilityAction', 'the element declares accessibilityActions but has no onAccessibilityAction', 'native');
      }
      await bridge.accessibilityAction(tag, name, declared.label, declared.index, declared.customIndex);
    },
  };

  function wheelContext(tag: number): WheelContext {
    const wheelInfo = bridge.wheelInfo as NonNullable<NativeBridge['wheelInfo']>;
    return {
      read: () => wheelInfo(tag),
      gesture: (path) => gesture(tag, path),
      clock,
      deadline: ctx.deadline,
      viewportHeight: ctx.viewport()?.height ?? null,
      platform: 'native',
    };
  }
}
