/** Phase 6.2 actions in the three performers: points, multiTap, replaceText, pressKey, from / distance, drag, tapAt. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hostPerformer } from '../src/actions/host';
import * as js from '../src/actions/js';
import { nativePerformer } from '../src/actions/native';
import type { NativeBridge } from '../src/actions/native';
import type { Clock } from '../src/sync';
import { node, tree } from './helpers/nodes';

const clock: Clock = { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as number), now: () => Date.now() };

async function run<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(60);
  return p;
}

describe('js mode', () => {
  it('tap at a point presses the topmost element there, with location in the event', () => {
    const calls: string[] = [];
    const roots = tree({
      testID: 'canvas',
      rect: { x: 0, y: 100, width: 200, height: 200 },
      owner: { onPress: (e: { nativeEvent: { locationX: number; locationY: number } }) => calls.push(`canvas@${e.nativeEvent.locationX},${e.nativeEvent.locationY}`) },
      children: [{ testID: 'corner', rect: { x: 150, y: 250, width: 50, height: 50 }, owner: { onPress: () => calls.push('corner') } }],
    });
    const ctx = { platform: 'ios', roots: () => roots };
    js.tap(roots[0]!, ctx, { x: 20, y: 30 });
    js.tap(roots[0]!, ctx, { x: 175, y: 175 });
    expect(calls).toEqual(['canvas@20,30', 'corner']);
    js.tapAt({ x: 160, y: 260 }, false, ctx);
    expect(calls.at(-1)).toBe('corner');
  });

  it('multiTap presses n times; replaceText sets the whole text', () => {
    const onPress = vi.fn();
    js.multiTap(node({ owner: { onPress } }), 3, { platform: 'ios' });
    expect(onPress).toHaveBeenCalledTimes(3);
    const onChangeText = vi.fn();
    js.replaceText(node({ owner: { onChangeText, value: 'old text' } }), 'new', { platform: 'ios' });
    expect(onChangeText).toHaveBeenCalledWith('new');
  });

  it('pressKey: enter submits (or adds a newline to a multi-line input), backspace removes a character', () => {
    const ctx = { platform: 'android' };
    const onSubmitEditing = vi.fn();
    const onKeyPress = vi.fn();
    js.pressKey(node({ owner: { onSubmitEditing, onKeyPress, onChangeText: () => {}, value: 'milk' } }), 'enter', ctx);
    expect(onSubmitEditing).toHaveBeenCalledWith({ nativeEvent: { text: 'milk' } });
    expect(onKeyPress).toHaveBeenCalledWith({ nativeEvent: { key: 'Enter' } });
    const onChangeText = vi.fn();
    js.pressKey(node({ owner: { onChangeText, multiline: true, value: 'a' } }), 'enter', ctx);
    expect(onChangeText).toHaveBeenLastCalledWith('a\n');
    js.pressKey(node({ owner: { onChangeText, value: 'abc' } }), 'backspace', ctx);
    expect(onChangeText).toHaveBeenLastCalledWith('ab');
    expect(() => js.pressKey(node({}), 'enter', ctx)).toThrow(expect.objectContaining({ errorName: 'ACTION_NOT_SUPPORTED' }));
  });

  it('a tap on a switch toggles it through onValueChange; a disabled one stays', () => {
    const onValueChange = vi.fn();
    js.tap(node({ type: 'Switch', owner: { onValueChange, value: false } }), { platform: 'ios' });
    expect(onValueChange).toHaveBeenCalledWith(true);
    js.tap(node({ type: 'Switch', owner: { onValueChange, value: true, disabled: true } }), { platform: 'ios' });
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it('scrollToEdge sets the offset to the end of the content', () => {
    let offset = { x: 0, y: 120 };
    const s: js.Scrollable = {
      offset: () => offset,
      viewport: () => ({ x: 0, y: 0, width: 300, height: 500 }),
      content: () => ({ x: 0, y: -offset.y, width: 300, height: 2000 }),
      host: () => null,
      scrollTo: (x, y) => {
        offset = { x, y };
      },
    };
    js.scrollToEdge(s, 'bottom');
    expect(offset).toEqual({ x: 0, y: 1500 });
    js.scrollToEdge(s, 'top');
    expect(offset).toEqual({ x: 0, y: 0 });
  });
});

function bridge() {
  return {
    locate: vi.fn(async () => ({ found: true, x: 10, y: 100, width: 200, height: 40, windowHasFocus: true })),
    tap: vi.fn(async () => ({ handled: true })),
    swipe: vi.fn(async (_tag: number, _fx: number, _fy: number, _tx: number, _ty: number, _ms: number) => ({ handled: true })),
    typeText: vi.fn(async (_t: number, text: string) => ({ text })),
    gesture: vi.fn(async (_tag: number, _path: number[]) => ({ handled: true })),
    pressKey: vi.fn(async () => ({ text: '' })),
  };
}

function nativeSetup(b: NativeBridge, action: 'tap' | 'drag' | 'pressKey' = 'tap') {
  const roots = tree({ testID: 'btn', tag: 7, rect: { x: 10, y: 100, width: 200, height: 40 } });
  const p = nativePerformer({ bridge: b, clock, roots: () => roots, viewport: () => ({ width: 400, height: 800 }), action, matcher: { id: 'btn' }, deadline: Date.now() + 5000 });
  return { p, target: roots[0]! };
}

describe('native mode', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('tap / long press at a point: a hold at that window point through gesture()', async () => {
    const b = bridge();
    const { p, target } = nativeSetup(b);
    await run(p.tap(target, { x: 5, y: 6 }));
    await run(p.longPress(target, 900, { x: 190, y: 30 }));
    expect(b.gesture.mock.calls).toEqual([
      [7, [15, 106, 0, 15, 106, 50]],
      [7, [200, 130, 0, 200, 130, 900]],
    ]);
    expect(b.tap).not.toHaveBeenCalled();
  });

  it('drag: hold at the center, move to the drop point, rest, release', async () => {
    const b = bridge();
    const { p, target } = nativeSetup(b, 'drag');
    await run(p.drag(target, { x: 300, y: 500 }, 800, 600));
    expect(b.gesture).toHaveBeenCalledWith(7, [110, 120, 0, 110, 120, 800, 300, 500, 1400, 300, 500, 1500]);
  });

  it('replaceText focuses with a tap and replaces; pressKey goes to the field without a touch', async () => {
    const b = bridge();
    const { p, target } = nativeSetup(b, 'pressKey');
    await run(p.replaceText(target, 'new'));
    expect(b.typeText).toHaveBeenCalledWith(7, 'new', true);
    b.tap.mockClear();
    await run(p.pressKey(target, 'enter'));
    expect(b.pressKey).toHaveBeenCalledWith(7, 'enter');
    expect(b.tap).not.toHaveBeenCalled();
  });

  it('swipe / scroll from a normalized start point over a distance', async () => {
    const b = bridge();
    const { p, target } = nativeSetup(b);
    await run(p.swipe(target, 'left', 'fast', 100, { x: 0.9, y: 0.5 }));
    expect(b.swipe).toHaveBeenLastCalledWith(7, 190, 120, 90, 120, 120);
    await run(p.scroll(target, 'down', 30, { x: 0.5, y: 0.75 }));
    expect(b.swipe).toHaveBeenLastCalledWith(7, 110, 130, 110, 100, 500); // scrolling down = finger up
  });

  it('tapAt taps a window point without an element', async () => {
    const b = bridge();
    const { p } = nativeSetup(b);
    await run(p.tapAt({ x: 33, y: 44 }));
    await run(p.tapAt({ x: 1, y: 2 }, 900));
    expect(b.tap.mock.calls).toEqual([
      [-1, 33, 44, 50, 1],
      [-1, 1, 2, 900, 1],
    ]);
  });

  it('an app built before gesture / pressKey existed gets a "rebuild the app" error', async () => {
    const old = bridge();
    delete (old as Partial<typeof old>).gesture;
    delete (old as Partial<typeof old>).pressKey;
    const { p, target } = nativeSetup(old, 'pressKey');
    const key = expect(p.pressKey(target, 'enter')).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', message: expect.stringContaining('pressKey()') });
    const tap = expect(p.tap(target, { x: 1, y: 1 })).rejects.toMatchObject({ data: { hint: expect.stringContaining('rebuild the app') } });
    await vi.advanceTimersByTimeAsync(60);
    await key;
    await tap;
  });
});

describe('host mode (web)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const roots = tree({ testID: 'btn', rect: { x: 10, y: 100, width: 200, height: 40 } });
    const p = hostPerformer({ clock, roots: () => roots, viewport: () => ({ width: 390, height: 844 }), matcher: { id: 'btn' }, deadline: Date.now() + 5000 });
    return { p, target: roots[0]!, spec: (roots[0] as unknown as { spec: { focusCalls?: number } }).spec };
  };

  it('points, multiTap, replaceText, tapAt', async () => {
    const { p, target } = setup();
    expect(await run(p.tap(target, { x: 5, y: 6 }))).toEqual({ kind: 'tap', x: 15, y: 106 });
    expect(await run(p.multiTap(target, 3))).toEqual({ kind: 'tap', x: 110, y: 120, count: 3 });
    expect(await run(p.replaceText(target, 'x'))).toEqual({ kind: 'type', x: 110, y: 120, text: 'x', clearFirst: true });
    expect(await run(p.tapAt({ x: 1, y: 2 }, 900))).toEqual({ kind: 'tap', x: 1, y: 2, holdMs: 900 });
  });

  it('pressKey focuses the element, then the host presses the key', async () => {
    const { p, target, spec } = setup();
    expect(await run(p.pressKey(target, 'backspace'))).toEqual({ kind: 'key', key: 'Backspace' });
    expect(spec.focusCalls).toBe(1);
  });

  it('drag carries the hold; wheel starts at `from`', async () => {
    const { p, target } = setup();
    expect(await run(p.drag(target, { x: 300, y: 500 }, 800, 600))).toEqual({ kind: 'drag', from: { x: 110, y: 120 }, to: { x: 300, y: 500 }, durationMs: 600, holdMs: 800 });
    expect(await run(p.scroll(target, 'down', 50, { x: 0, y: 0 }))).toEqual({ kind: 'wheel', x: 10, y: 100, dx: 0, dy: 50 });
  });
});

describe('native reach check by React tags (Fabric mounts some children outside their React parent)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  // canvas (tag 7) > quadrant (tag 8); an unrelated overlay (tag 20). Native: the quadrant's superview
  // is the screen (tag 1), not the canvas, so UIKit's isDescendant says "not reached".
  const roots = () =>
    tree(
      { testID: 'screen', tag: 1, rect: { x: 0, y: 0, width: 400, height: 800 }, children: [
        { testID: 'canvas', tag: 7, rect: { x: 10, y: 100, width: 200, height: 100 }, children: [{ tag: 8, rect: { x: 10, y: 100, width: 100, height: 50 } }] },
        { testID: 'overlay', tag: 20, rect: { x: 300, y: 300, width: 10, height: 10 } },
      ] },
    );

  const performer = (b: NativeBridge, r = roots()) => {
    const canvas = r[0]!.children[0]!;
    return { p: nativePerformer({ bridge: b, clock, roots: () => r, viewport: () => ({ width: 400, height: 800 }), action: 'tap', matcher: { id: 'canvas' }, deadline: Date.now() + 5000 }), canvas };
  };

  it('a hit on a React descendant mounted elsewhere still reaches the element', async () => {
    const b = { ...bridge(), locate: vi.fn(async () => ({ found: true, x: 10, y: 100, width: 200, height: 100, windowHasFocus: false, hitTags: [8, 1, 0, 0] })) };
    const { p, canvas } = performer(b);
    await run(p.tap(canvas));
    expect(b.tap).toHaveBeenCalledWith(7, 0, 0, 50, 1);
  });

  it('a hit on an unrelated React view is ELEMENT_OBSCURED', async () => {
    const b = { ...bridge(), locate: vi.fn(async () => ({ found: true, x: 10, y: 100, width: 200, height: 100, windowHasFocus: false, hitClass: 'RCTViewComponentView', hitTags: [0, 20, 1] })) };
    const { p, canvas } = performer(b);
    const done = expect(p.tap(canvas)).rejects.toMatchObject({ errorName: 'ELEMENT_OBSCURED' });
    await vi.advanceTimersByTimeAsync(60);
    await done;
  });

  it('a tap at a point asks the native side about that point (hitAt)', async () => {
    const hitAt = vi.fn(async () => ({ windowHasFocus: false, hitTags: [8, 1] }));
    const b = { ...bridge(), locate: vi.fn(async () => ({ found: true, x: 10, y: 100, width: 200, height: 100, windowHasFocus: true })), hitAt };
    const { p, canvas } = performer(b);
    await run(p.tap(canvas, { x: 20, y: 30 }));
    expect(hitAt).toHaveBeenCalledWith(7, 30, 130);
    expect(b.gesture).toHaveBeenCalledWith(7, [30, 130, 0, 30, 130, 50]);
  });
});
