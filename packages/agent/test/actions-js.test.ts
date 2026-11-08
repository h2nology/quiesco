import { describe, expect, it, vi } from 'vitest';

import * as js from '../src/actions/js';
import type { InstanceRef } from '../src/fiber-adapter';
import { node } from './helpers/nodes';

const ctx = { platform: 'android' };

describe('js tap / longPress / doubleTap', () => {
  it('calls onPressIn → onPress → onPressOut of the owning component with a press event', () => {
    const calls: string[] = [];
    const n = node({
      rect: { x: 10, y: 20, width: 100, height: 40 },
      owner: { onPressIn: () => calls.push('in'), onPress: (e: { nativeEvent: { pageX: number; pageY: number } }) => calls.push(`press@${e.nativeEvent.pageX},${e.nativeEvent.pageY}`), onPressOut: () => calls.push('out') },
    });
    js.tap(n, ctx);
    expect(calls).toEqual(['in', 'press@60,40', 'out']);
  });

  it('does nothing when the owner is disabled (like Pressability)', () => {
    const onPress = vi.fn();
    js.tap(node({ owner: { onPress, disabled: true } }), ctx);
    js.tap(node({ owner: { onPress }, props: { accessibilityState: { disabled: true } } }), ctx);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('fails with ACTION_NOT_SUPPORTED when there is no handler', () => {
    expect(() => js.tap(node({}), ctx)).toThrow(expect.objectContaining({ errorName: 'ACTION_NOT_SUPPORTED', message: expect.stringMatching(/no onPress handler/) }));
  });

  it('longPress uses onLongPress; doubleTap presses twice', () => {
    const onLongPress = vi.fn();
    const onPress = vi.fn();
    js.longPress(node({ owner: { onLongPress } }), ctx);
    js.multiTap(node({ owner: { onPress } }), 2, ctx);
    expect(onLongPress).toHaveBeenCalledOnce();
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('js type / clear', () => {
  it('appends to the current value and calls onChange then onChangeText', () => {
    const calls: unknown[] = [];
    const n = node({ owner: { value: 'ab', onChange: (e: { nativeEvent: { text: string } }) => calls.push(['change', e.nativeEvent.text]), onChangeText: (t: string) => calls.push(['text', t]) } });
    js.typeText(n, 'c', ctx);
    expect(calls).toEqual([['change', 'abc'], ['text', 'abc']]);
  });

  it('uses defaultValue when uncontrolled, and clear() sends an empty string', () => {
    const onChangeText = vi.fn();
    js.typeText(node({ owner: { defaultValue: 'x', onChangeText } }), 'y', ctx);
    js.clearText(node({ owner: { value: 'abc', onChangeText } }), ctx);
    expect(onChangeText.mock.calls).toEqual([['xy'], ['']]);
  });

  it('skips non-editable inputs and fails without a handler', () => {
    const onChangeText = vi.fn();
    js.typeText(node({ owner: { editable: false, onChangeText } }), 'y', ctx);
    expect(onChangeText).not.toHaveBeenCalled();
    expect(() => js.clearText(node({}), ctx)).toThrow(/clear is not possible in js mode/);
  });
});

describe('js scroll', () => {
  function scrollView(offsetY: number) {
    const calls: unknown[] = [];
    const scroll = node({
      rect: { x: 0, y: 100, width: 400, height: 500 },
      children: [{ rect: { x: 0, y: 100 - offsetY, width: 400, height: 3000 } }],
    });
    const instance: InstanceRef = { raw: () => ({}), call: (arg) => calls.push(arg), hostNodes: () => [scroll] };
    return { calls, target: node({ instance }) };
  }

  it('computes the offset from the content container and scrolls by 80% of the viewport', () => {
    const { calls, target } = scrollView(200);
    const s = js.requireScrollable(target, 'scroll', ctx);
    expect(s.offset()).toEqual({ x: 0, y: 200 });
    js.scrollBy(s, 'down');
    js.scrollBy(s, 'up', 300);
    js.scrollBy(s, 'right', 50);
    expect(calls).toEqual([
      { x: 0, y: 600, animated: false },
      { x: 0, y: 0, animated: false }, // clamped at 0
      { x: 50, y: 200, animated: false },
    ]);
  });

  it('maps swipe directions to the opposite scroll direction', () => {
    expect(js.swipeToScrollDirection('up')).toBe('down');
    expect(js.swipeToScrollDirection('left')).toBe('right');
  });

  it('fails outside a ScrollView', () => {
    expect(() => js.requireScrollable(node({}), 'swipe', ctx)).toThrow(/not inside a ScrollView/);
  });
});
