/**
 * `native` action mode (requirements.md §6.3): real input through @quiesco/native, so hit testing,
 * gesture handlers, pressed states and focus behave as for a user.
 *
 * Before touching an element:
 * 1. its native view must stay at the same place for two consecutive checks (transitions finished);
 * 2. its window must have the input focus (otherwise e.g. a Modal is on top) → ELEMENT_OBSCURED;
 * 3. within the window, the topmost element at its center must be the element or a descendant
 *    (elements with pointerEvents none / box-none are transparent) → ELEMENT_OBSCURED.
 * The touch point itself is computed natively from the view (docs/spikes, Phase 2.0 findings).
 */
import type { Direction, Matcher, Rect, Speed } from '@quiesco/protocol';

import { QuiescoError } from '../errors';
import type { HostNode, Viewport } from '../fiber-adapter';
import { summarize } from '../query';
import type { Clock } from '../sync';
import type { ActionPerformer } from './performer';

/** The parts of @quiesco/native used here (see packages/native/src/index.ts). */
export interface NativeBridge {
  locate(tag: number): Promise<{ found: boolean; x?: number; y?: number; width?: number; height?: number; windowHasFocus?: boolean }>;
  tap(tag: number, x: number, y: number, holdMs: number, count: number): Promise<{ handled: boolean }>;
  swipe(tag: number, fromX: number, fromY: number, toX: number, toY: number, durationMs: number): Promise<{ handled: boolean }>;
  typeText(tag: number, text: string, replace: boolean): Promise<{ text: string }>;
}

export interface NativeContext {
  bridge: NativeBridge;
  clock: Clock;
  roots: () => readonly HostNode[];
  viewport: () => Viewport | null;
  /** Matcher of the current action, for error data. */
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

export function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function contains(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
}

/** Whether `a` is `b` or one of its ancestors (compared as rendered elements, not objects). */
export function isAncestor(a: HostNode, b: HostNode): boolean {
  for (let n: HostNode | null = b; n !== null; n = n.parent) if (a.isSameElement(n)) return true;
  return false;
}

export function describe(n: HostNode): string {
  const id = n.testID !== undefined ? ` testID="${n.testID}"` : '';
  const text = n.text !== '' ? ` text="${n.text.slice(0, 40)}"` : '';
  return `<${n.type}${id}${text}>`;
}

/**
 * Topmost host node whose rect contains `p` (later in render order = drawn on top; zIndex / elevation
 * are not considered). `pointerEvents: none` removes a subtree, `box-none` only the node itself.
 */
export function hitTest(roots: readonly HostNode[], p: { x: number; y: number }): HostNode | null {
  let top: HostNode | null = null;
  const visit = (n: HostNode): void => {
    if (n.hiddenByStyle) return;
    const pe = n.props['pointerEvents'];
    if (pe === 'none') return;
    const r = n.measure();
    if (pe !== 'box-none' && r !== null && r.width > 0 && r.height > 0 && contains(r, p)) top = n;
    for (const c of n.children) visit(c);
  };
  for (const r of roots) visit(r);
  return top;
}

function tagOf(node: HostNode, matcher: Matcher): number {
  const tag = node.nativeTag();
  if (tag === null) {
    throw new QuiescoError('ACTION_NOT_SUPPORTED', 'native mode cannot address this element (no native view tag)', {
      action: 'tap',
      platform: 'native',
      hint: `element ${JSON.stringify(matcher)} has no native view; use mode 'js' for this call`,
    });
  }
  return tag;
}

export function nativePerformer(ctx: NativeContext): ActionPerformer {
  const { bridge, clock } = ctx;
  const sleep = (ms: number): Promise<void> =>
    new Promise((r) => {
      clock.setTimeout(r, ms);
    });

  /** Wait until the native view stops moving, then check it can receive the touch. */
  const ready = async (node: HostNode): Promise<{ tag: number; rect: Rect }> => {
    const tag = tagOf(node, ctx.matcher);
    let prev: Rect | null = null;
    for (;;) {
      const loc = await bridge.locate(tag);
      if (!loc.found || loc.x === undefined || loc.y === undefined || loc.width === undefined || loc.height === undefined) {
        throw new QuiescoError('ELEMENT_NOT_FOUND', 'The element has no native view (unmounted?)', { matcher: ctx.matcher });
      }
      const rect = { x: loc.x, y: loc.y, width: loc.width, height: loc.height };
      const same = prev !== null && Math.abs(prev.x - rect.x) < 0.5 && Math.abs(prev.y - rect.y) < 0.5 && Math.abs(prev.width - rect.width) < 0.5;
      if (same || clock.now() >= ctx.deadline) {
        if (loc.windowHasFocus === false) throw obscured(node, 'another window (e.g. a Modal or dialog)');
        const top = hitTest(ctx.roots(), center(node.measure() ?? rect));
        if (top !== null && !isAncestor(node, top)) throw obscured(node, describe(top));
        return { tag, rect };
      }
      prev = rect;
      await sleep(STABLE_POLL_MS);
    }
  };

  const obscured = (node: HostNode, by: string): QuiescoError =>
    new QuiescoError('ELEMENT_OBSCURED', `${describe(node)} is covered by ${by}; a real touch would not reach it`, {
      matcher: ctx.matcher,
      element: summarize(node, ctx.viewport()),
      obscuredBy: by,
    });

  /** Finger drag inside the element, in its window coordinates. */
  const drag = async (node: HostNode, finger: Direction, durationMs: number, distance?: number): Promise<void> => {
    const { tag, rect } = await ready(node);
    const c = center(rect);
    const vertical = finger === 'up' || finger === 'down';
    const span = vertical ? rect.height : rect.width;
    const half = Math.min((distance ?? span * DRAG_FRACTION * 2) / 2, span * 0.45);
    const sign = finger === 'down' || finger === 'right' ? 1 : -1;
    const from = vertical ? { x: c.x, y: c.y - sign * half } : { x: c.x - sign * half, y: c.y };
    const to = vertical ? { x: c.x, y: c.y + sign * half } : { x: c.x + sign * half, y: c.y };
    await bridge.swipe(tag, from.x, from.y, to.x, to.y, durationMs);
  };

  /** Content direction → finger direction (scroll down = finger moves up). */
  const fingerFor = (content: Direction): Direction => ({ up: 'down', down: 'up', left: 'right', right: 'left' } as const)[content];

  return {
    viaHost: false,
    async tap(node) {
      const { tag } = await ready(node);
      await bridge.tap(tag, 0, 0, TAP_HOLD_MS, 1);
    },
    async longPress(node, durationMs) {
      const { tag } = await ready(node);
      await bridge.tap(tag, 0, 0, durationMs ?? LONG_PRESS_MS, 1);
    },
    async doubleTap(node) {
      const { tag } = await ready(node);
      await bridge.tap(tag, 0, 0, TAP_HOLD_MS, 2);
    },
    async type(node, text) {
      const { tag } = await ready(node);
      await bridge.tap(tag, 0, 0, TAP_HOLD_MS, 1); // focus, like a user
      await bridge.typeText(tag, text, false);
    },
    async clear(node) {
      const { tag } = await ready(node);
      await bridge.tap(tag, 0, 0, TAP_HOLD_MS, 1);
      await bridge.typeText(tag, '', true);
    },
    scroll: (node, direction, distance) => drag(node, fingerFor(direction), SCROLL_DRAG_MS, distance),
    swipe: (node, direction, speed) => drag(node, direction, SWIPE_MS[speed ?? 'normal']),
  };
}
