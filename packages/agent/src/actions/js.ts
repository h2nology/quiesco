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
 *   (FlatList / SectionList included). Other scrollables (pager views ...) are not supported.
 */
import type { Direction, Rect } from '@quiesco/protocol';

import { QuiescoError } from '../errors';
import type { HandlerRef, HostNode } from '../fiber-adapter';

export interface JsActionContext {
  platform: string;
}

/** Synthetic event passed to press handlers: the fields user code commonly reads. */
function pressEvent(node: HostNode, type: string): Record<string, unknown> {
  const r = node.measure();
  const cx = r === null ? 0 : r.x + r.width / 2;
  const cy = r === null ? 0 : r.y + r.height / 2;
  const nativeEvent = {
    locationX: r === null ? 0 : r.width / 2,
    locationY: r === null ? 0 : r.height / 2,
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

function notSupported(action: 'tap' | 'longPress' | 'doubleTap' | 'type' | 'clear' | 'scroll' | 'swipe' | 'scrollTo', ctx: JsActionContext, hint: string): QuiescoError {
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

function press(node: HostNode, handlerName: 'onPress' | 'onLongPress', action: 'tap' | 'longPress' | 'doubleTap', ctx: JsActionContext): void {
  const owner = node.findHandler(handlerName);
  if (owner === null) throw notSupported(action, ctx, `no ${handlerName} handler on the element or its ancestors (gesture-handler gestures need native mode)`);
  if (isDisabled(node, owner)) return;
  call(owner, 'onPressIn', pressEvent(node, 'pressIn'));
  owner.fn(pressEvent(node, handlerName === 'onPress' ? 'press' : 'longPress'));
  call(owner, 'onPressOut', pressEvent(node, 'pressOut'));
}

export function tap(node: HostNode, ctx: JsActionContext): void {
  press(node, 'onPress', 'tap', ctx);
}

export function longPress(node: HostNode, ctx: JsActionContext): void {
  press(node, 'onLongPress', 'longPress', ctx);
}

export function doubleTap(node: HostNode, ctx: JsActionContext): void {
  press(node, 'onPress', 'doubleTap', ctx);
  press(node, 'onPress', 'doubleTap', ctx);
}

function changeText(node: HostNode, action: 'type' | 'clear', next: (current: string) => string, ctx: JsActionContext): void {
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

export interface Scrollable {
  /** Current content offset. */
  offset(): { x: number; y: number };
  /** Size of the scroll viewport. */
  viewport(): Rect | null;
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

/** A swipe moves the finger; the content scrolls the opposite way (swipe up = scroll down). */
export function swipeToScrollDirection(direction: Direction): Direction {
  return ({ up: 'down', down: 'up', left: 'right', right: 'left' } as const)[direction];
}

export function requireScrollable(node: HostNode, action: 'scroll' | 'swipe' | 'scrollTo', ctx: JsActionContext): Scrollable {
  const s = findScrollable(node);
  if (s === null) throw notSupported(action, ctx, 'the element is not inside a ScrollView / FlatList');
  return s;
}
