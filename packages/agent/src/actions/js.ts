/**
 * `js` action mode (requirements.md §6.3): call the components' callbacks directly. Fast and needs no
 * native code, but skips hit testing. Limitations (documented):
 * - tap / longPress / doubleTap call the nearest `onPress` / `onLongPress` found from the element up
 *   to the root, together with that component's `onPressIn` / `onPressOut`. A component with
 *   `disabled: true` is not pressed (like Pressability). Gesture-handler gestures (`Gesture.Tap()` ...)
 *   have no such prop and are not supported.
 * - type / clear call `onChangeText` (and `onChange`) of the nearest TextInput with the new full text.
 *   Controlled inputs update through their `value`; uncontrolled inputs keep their native text.
 *   `type` appends to the current `value` (or `defaultValue`) in a single call, not key by key.
 * - scroll / swipe / scrollTo call `scrollTo({ x, y, animated: false })` on the nearest ScrollView
 *   (FlatList / SectionList included). Other scrollables (pager views ...) are not supported. `from`
 *   (a start point) has no meaning here and is ignored.
 * - A tap at a point (`tap(t, { point })`, `tapAt`) presses the topmost element under that point.
 * - A tap on a switch / checkbox without onPress calls `onValueChange(!value)` (unless disabled).
 * - pressKey: `enter` calls `onSubmitEditing` (a multi-line input without it gets a newline);
 *   `backspace` calls `onKeyPress` and removes the last character.
 * - drag is not supported (it needs real touches).
 */
import type { Direction, Edge, KeyName, Point, Rect } from '@quiesco/protocol';

import { QuiescoError } from '../errors';
import type { HandlerRef, HostNode } from '../fiber-adapter';
import { hitTest } from './hit-test';

export interface JsActionContext {
  platform: string;
  /** Current host roots, for taps at a point (hit testing). */
  roots?: () => readonly HostNode[];
}

/** Holding at least this long is a long press (`longPressAt`). */
export const LONG_PRESS_THRESHOLD_MS = 500;

/** Synthetic event passed to press handlers: the fields user code commonly reads. `at`: window point. */
function pressEvent(node: HostNode, type: string, at?: Point): Record<string, unknown> {
  const r = node.measure();
  const cx = at?.x ?? (r === null ? 0 : r.x + r.width / 2);
  const cy = at?.y ?? (r === null ? 0 : r.y + r.height / 2);
  const nativeEvent = {
    locationX: r === null ? 0 : cx - r.x,
    locationY: r === null ? 0 : cy - r.y,
    pageX: cx,
    pageY: cy,
    timestamp: Date.now(),
    identifier: 0,
    touches: [],
    changedTouches: [],
  };
  let defaultPrevented = false;
  return {
    type,
    nativeEvent,
    timeStamp: nativeEvent.timestamp,
    persist() {},
    preventDefault() {
      defaultPrevented = true;
    },
    isDefaultPrevented: () => defaultPrevented,
    stopPropagation() {},
    isPropagationStopped: () => false,
  };
}

type JsAction = 'tap' | 'longPress' | 'doubleTap' | 'multiTap' | 'type' | 'replaceText' | 'clear' | 'pressKey' | 'scroll' | 'swipe' | 'scrollTo' | 'drag' | 'tapAt';

export function notSupported(action: JsAction, ctx: JsActionContext, hint: string): QuiescoError {
  return new QuiescoError('ACTION_NOT_SUPPORTED', `${action} is not possible in js mode: ${hint}`, { action, platform: ctx.platform, hint });
}

function isDisabled(node: HostNode, owner: HandlerRef): boolean {
  if (owner.props['disabled'] === true) return true;
  const a11y = node.props['accessibilityState'] as { disabled?: unknown } | undefined;
  return a11y?.disabled === true || node.props['aria-disabled'] === true;
}

function call(owner: HandlerRef, name: string, event: unknown): void {
  const fn = owner.props[name];
  if (typeof fn === 'function') (fn as (e: unknown) => unknown)(event);
}

/** A tap on a switch / checkbox without onPress toggles it through `onValueChange` (what the native control does). */
function toggle(node: HostNode): boolean {
  const owner = node.findHandler('onValueChange');
  if (owner === null || typeof owner.props['value'] !== 'boolean') return false;
  if (owner.props['disabled'] === true) return true;
  owner.fn(!owner.props['value']);
  return true;
}

function press(node: HostNode, handlerName: 'onPress' | 'onLongPress', action: JsAction, ctx: JsActionContext, at?: Point): void {
  const owner = node.findHandler(handlerName);
  if (owner === null && handlerName === 'onPress' && toggle(node)) return;
  if (owner === null) throw notSupported(action, ctx, `no ${handlerName} handler on the element or its ancestors (gesture-handler gestures need native mode)`);
  if (isDisabled(node, owner)) return;
  call(owner, 'onPressIn', pressEvent(node, 'pressIn', at));
  owner.fn(pressEvent(node, handlerName === 'onPress' ? 'press' : 'longPress', at));
  call(owner, 'onPressOut', pressEvent(node, 'pressOut', at));
}

/** The topmost element at the window point `p` (hit testing like a real touch). */
function elementAt(p: Point, action: JsAction, ctx: JsActionContext): HostNode {
  const top = ctx.roots === undefined ? null : hitTest(ctx.roots(), p);
  if (top === null) throw notSupported(action, ctx, `no element at (${Math.round(p.x)}, ${Math.round(p.y)})`);
  return top;
}

/** `point` inside `node` → the topmost element there (a child may be on top of the target). */
function pressAt(node: HostNode, point: Point | undefined, handler: 'onPress' | 'onLongPress', action: JsAction, ctx: JsActionContext): void {
  if (point === undefined) return press(node, handler, action, ctx);
  const r = node.measure();
  const at = { x: (r?.x ?? 0) + point.x, y: (r?.y ?? 0) + point.y };
  press(elementAt(at, action, ctx), handler, action, ctx, at);
}

export function tap(node: HostNode, ctx: JsActionContext, point?: Point): void {
  pressAt(node, point, 'onPress', 'tap', ctx);
}

export function longPress(node: HostNode, ctx: JsActionContext, point?: Point): void {
  pressAt(node, point, 'onLongPress', 'longPress', ctx);
}

export function multiTap(node: HostNode, count: number, ctx: JsActionContext): void {
  for (let i = 0; i < count; i++) press(node, 'onPress', count === 2 ? 'doubleTap' : 'multiTap', ctx);
}

export function tapAt(p: Point, long: boolean, ctx: JsActionContext): void {
  press(elementAt(p, 'tapAt', ctx), long ? 'onLongPress' : 'onPress', 'tapAt', ctx, p);
}

function changeText(node: HostNode, action: JsAction, next: (current: string) => string, ctx: JsActionContext): void {
  const owner = node.findHandler('onChangeText') ?? node.findHandler('onChange');
  if (owner === null) throw notSupported(action, ctx, 'no onChangeText / onChange handler on the element or its ancestors');
  if (owner.props['editable'] === false || owner.props['readOnly'] === true) return;
  const v = owner.props['value'] ?? owner.props['defaultValue'];
  const text = next(typeof v === 'string' ? v : '');
  call(owner, 'onFocus', { nativeEvent: { text: typeof v === 'string' ? v : '' } });
  call(owner, 'onChange', { nativeEvent: { text, eventCount: 0, target: 0 } });
  call(owner, 'onChangeText', text);
}

export function typeText(node: HostNode, text: string, ctx: JsActionContext): void {
  changeText(node, 'type', (current) => current + text, ctx);
}

export function clearText(node: HostNode, ctx: JsActionContext): void {
  changeText(node, 'clear', () => '', ctx);
}

export function replaceText(node: HostNode, text: string, ctx: JsActionContext): void {
  changeText(node, 'replaceText', () => text, ctx);
}

export function pressKey(node: HostNode, key: KeyName, ctx: JsActionContext): void {
  const input = node.findHandler('onChangeText') ?? node.findHandler('onSubmitEditing') ?? node.findHandler('onKeyPress');
  if (input === null) throw notSupported('pressKey', ctx, 'no text input (onChangeText / onSubmitEditing / onKeyPress) on the element or its ancestors');
  const value = input.props['value'] ?? input.props['defaultValue'];
  const text = typeof value === 'string' ? value : '';
  call(input, 'onKeyPress', { nativeEvent: { key: key === 'enter' ? 'Enter' : 'Backspace' } });
  if (key === 'backspace') {
    if (typeof input.props['onChangeText'] === 'function' || typeof input.props['onChange'] === 'function') changeText(node, 'pressKey', (t) => t.slice(0, -1), ctx);
    return;
  }
  if (typeof input.props['onSubmitEditing'] === 'function') {
    call(input, 'onSubmitEditing', { nativeEvent: { text } });
  } else if (input.props['multiline'] === true) {
    changeText(node, 'pressKey', (t) => `${t}\n`, ctx);
  }
}

export interface Scrollable {
  /** Current content offset. */
  offset(): { x: number; y: number };
  /** Size of the scroll viewport. */
  viewport(): Rect | null;
  /** The content container (its size is the scrollable extent). */
  content(): Rect | null;
  scrollTo(x: number, y: number): void;
}

/** The ScrollView that contains `node` (or is `node`), or null. */
export function findScrollable(node: HostNode): Scrollable | null {
  const inst = node.findInstance('scrollTo');
  if (inst === null) return null;
  // ScrollView renders: native scroll view host → content container host → children.
  const host = (): { scroll: HostNode | null; content: HostNode | null } => {
    const scroll = inst.hostNodes()[0] ?? null;
    return { scroll, content: scroll?.children[0] ?? null };
  };
  return {
    offset() {
      const { scroll, content } = host();
      const s = scroll?.measure();
      const c = content?.measure();
      if (s == null || c == null) return { x: 0, y: 0 };
      return { x: s.x - c.x, y: s.y - c.y };
    },
    viewport: () => host().scroll?.measure() ?? null,
    content: () => host().content?.measure() ?? null,
    scrollTo(x, y) {
      inst.call({ x: Math.max(0, x), y: Math.max(0, y), animated: false });
    },
  };
}

/** Fraction of the viewport moved by one scroll / swipe step when no distance is given. */
export const STEP_FRACTION = 0.8;

/** `down` reveals content further down (offset grows), like Detox's scroll direction. */
export function scrollBy(s: Scrollable, direction: Direction, distance?: number): void {
  const vp = s.viewport();
  const vertical = direction === 'up' || direction === 'down';
  const d = distance ?? (vp === null ? 300 : (vertical ? vp.height : vp.width) * STEP_FRACTION);
  const { x, y } = s.offset();
  const sign = direction === 'down' || direction === 'right' ? 1 : -1;
  s.scrollTo(vertical ? x : x + sign * d, vertical ? y + sign * d : y);
}

/** Jump to an edge of the current content (a virtualized list may grow afterwards; callers repeat). */
export function scrollToEdge(s: Scrollable, edge: Edge): void {
  const vp = s.viewport();
  const content = s.content();
  const { x, y } = s.offset();
  const maxX = vp === null || content === null ? x : Math.max(0, content.width - vp.width);
  const maxY = vp === null || content === null ? y : Math.max(0, content.height - vp.height);
  if (edge === 'top') s.scrollTo(x, 0);
  else if (edge === 'bottom') s.scrollTo(x, maxY);
  else if (edge === 'left') s.scrollTo(0, y);
  else s.scrollTo(maxX, y);
}

/** A swipe moves the finger; the content scrolls the opposite way (swipe up = scroll down). */
export function swipeToScrollDirection(direction: Direction): Direction {
  return ({ up: 'down', down: 'up', left: 'right', right: 'left' } as const)[direction];
}

export function requireScrollable(node: HostNode, action: 'scroll' | 'swipe' | 'scrollTo', ctx: JsActionContext): Scrollable {
  const s = findScrollable(node);
  if (s === null) throw notSupported(action, ctx, 'the element is not inside a ScrollView / FlatList');
  return s;
}
