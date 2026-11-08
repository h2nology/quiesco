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
  };
}
