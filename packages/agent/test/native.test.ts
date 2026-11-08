import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fromNativeError, hitTest, nativePerformer } from '../src/actions/native';
import type { NativeBridge } from '../src/actions/native';
import type { Clock } from '../src/sync';
import { node, tree } from './helpers/nodes';

const clock: Clock = { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as number), now: () => Date.now() };

function bridge(locations: Partial<Awaited<ReturnType<NativeBridge['locate']>>>[] = [{}]) {
  let i = 0;
  return {
    locate: vi.fn(async () => {
      const l = locations[Math.min(i++, locations.length - 1)];
      return { found: true, x: 0, y: 0, width: 100, height: 40, windowHasFocus: true, ...l };
    }),
    tap: vi.fn(async (_tag: number, _x: number, _y: number, _holdMs: number, _count: number) => ({ handled: true })),
    swipe: vi.fn(async (_tag: number, _fx: number, _fy: number, _tx: number, _ty: number, _ms: number) => ({ handled: true })),
    typeText: vi.fn(async (_t: number, text: string) => ({ text })),
  };
}

function setup(b: ReturnType<typeof bridge>, roots = tree({ testID: 'btn', tag: 7, rect: { x: 0, y: 0, width: 100, height: 40 } })) {
  const target = roots[0]!;
  const p = nativePerformer({ bridge: b, clock, roots: () => roots, viewport: () => ({ width: 400, height: 800 }), action: 'tap', matcher: { id: 'btn' }, deadline: Date.now() + 5000 });
  return { p, target, roots };
}

describe('hitTest', () => {
  it('returns the topmost node in render order, skipping pointerEvents none / box-none and hidden nodes', () => {
    const roots = tree(
      { testID: 'button', rect: { x: 0, y: 0, width: 100, height: 40 }, children: [{ testID: 'label', rect: { x: 10, y: 10, width: 50, height: 20 } }] },
      { testID: 'overlay-none', rect: { x: 0, y: 0, width: 400, height: 800 }, props: { pointerEvents: 'none' } },
      { testID: 'overlay-box-none', rect: { x: 0, y: 0, width: 400, height: 800 }, props: { pointerEvents: 'box-none' } },
      { testID: 'hidden', rect: { x: 0, y: 0, width: 400, height: 800 }, hidden: true },
    );
    expect(hitTest(roots, { x: 20, y: 15 })?.testID).toBe('label');
    expect(hitTest(roots, { x: 90, y: 35 })?.testID).toBe('button');
    expect(hitTest(roots, { x: 300, y: 300 })).toBeNull();
    const covered = [...roots, node({ testID: 'toast', rect: { x: 0, y: 0, width: 400, height: 100 } })];
    expect(hitTest(covered, { x: 20, y: 15 })?.testID).toBe('toast');
  });
});

describe('nativePerformer', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('waits until the native view stops moving, then taps it by tag', async () => {
    const b = bridge([{ x: 300 }, { x: 120 }, { x: 0 }, { x: 0 }]);
    const { p, target } = setup(b);
    const done = p.tap(target);
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(b.locate).toHaveBeenCalledTimes(4);
    expect(b.tap).toHaveBeenCalledWith(7, 0, 0, 50, 1);
  });

  it('long press, double tap', async () => {
    const b = bridge();
    const { p, target } = setup(b);
    const run = async (f: () => Promise<unknown>) => {
      const x = f();
      await vi.advanceTimersByTimeAsync(50);
      await x;
    };
    await run(() => p.longPress(target, 1200));
    await run(() => p.longPress(target));
    await run(() => p.doubleTap(target));
    expect(b.tap.mock.calls).toEqual([
      [7, 0, 0, 1200, 1],
      [7, 0, 0, 800, 1],
      [7, 0, 0, 50, 2],
    ]);
  });

  it('types by focusing with a tap, then through the IME path; clear replaces with ""', async () => {
    const b = bridge();
    const { p, target } = setup(b);
    const t = p.type(target, '买牛奶');
    await vi.advanceTimersByTimeAsync(50);
    await t;
    const c = p.clear(target);
    await vi.advanceTimersByTimeAsync(50);
    await c;
    expect(b.tap).toHaveBeenCalledTimes(2);
    expect(b.typeText.mock.calls).toEqual([
      [7, '买牛奶', false],
      [7, '', true],
    ]);
  });

  it('scroll down drags the finger up inside the element; swipe follows the finger', async () => {
    const b = bridge([{ x: 0, y: 100, width: 400, height: 600 }]);
    const { p, target } = setup(b);
    const s = p.scroll(target, 'down');
    await vi.advanceTimersByTimeAsync(50);
    await s;
    const [, fx, fy, tx, ty, ms] = b.swipe.mock.calls[0]!;
    expect(fx).toBe(tx);
    expect(fy).toBeGreaterThan(ty); // finger moves up
    expect(ms).toBe(500);
    const w = p.swipe(target, 'left', 'fast');
    await vi.advanceTimersByTimeAsync(50);
    await w;
    const [, fx2, , tx2, , ms2] = b.swipe.mock.calls[1]!;
    expect(fx2).toBeGreaterThan(tx2);
    expect(ms2).toBe(120);
  });

  it('fails with ELEMENT_OBSCURED when another window has the focus', async () => {
    const b = bridge([{ windowHasFocus: false }]);
    const { p, target } = setup(b);
    const r = p.tap(target);
    const a = expect(r).rejects.toMatchObject({ errorName: 'ELEMENT_OBSCURED', data: { obscuredBy: expect.stringContaining('Modal') } });
    await vi.advanceTimersByTimeAsync(100);
    await a;
    expect(b.tap).not.toHaveBeenCalled();
  });

  it('fails with ELEMENT_OBSCURED when another element covers the center', async () => {
    const roots = tree(
      { testID: 'btn', tag: 7, rect: { x: 0, y: 0, width: 100, height: 40 } },
      { testID: 'banner', type: 'RCTView', text: 'Cookies?', rect: { x: 0, y: 0, width: 400, height: 60 } },
    );
    const b = bridge();
    const { p } = setup(b, roots);
    const r = p.tap(roots[0]!);
    const a = expect(r).rejects.toMatchObject({ errorName: 'ELEMENT_OBSCURED', message: expect.stringContaining('<RCTView testID="banner" text="Cookies?">') });
    await vi.advanceTimersByTimeAsync(100);
    await a;
  });

  it('keeps waiting while the native side reports settling (iOS view controller transition), even if the view does not move', async () => {
    const b = bridge([{ settling: true }, { settling: true }, { settling: true }, { settling: false }]);
    const { p, target } = setup(b);
    const done = p.tap(target);
    await vi.advanceTimersByTimeAsync(200);
    await done;
    // Taps at the first check that is not settling and has the same position as the previous one.
    expect(b.locate).toHaveBeenCalledTimes(4);
    expect(b.tap).toHaveBeenCalledTimes(1);
  });

  it('maps native rejections: E_UNSUPPORTED → ACTION_NOT_SUPPORTED with a js-mode hint, E_NO_VIEW → ELEMENT_NOT_FOUND', async () => {
    const unsupported = Object.assign(new Error('touch injection needs private UIKit API'), { code: 'E_UNSUPPORTED' });
    const b = bridge();
    b.tap.mockRejectedValueOnce(unsupported);
    const { p, target } = setup(b);
    const r = p.tap(target);
    const a = expect(r).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', data: { hint: expect.stringContaining("'js'") } });
    await vi.advanceTimersByTimeAsync(100);
    await a;

    b.typeText.mockRejectedValueOnce(Object.assign(new Error('view 7 not found'), { code: 'E_NO_VIEW' }));
    const t = p.type(target, 'x');
    const ta = expect(t).rejects.toMatchObject({ errorName: 'ELEMENT_NOT_FOUND', data: { matcher: { id: 'btn' } } });
    await vi.advanceTimersByTimeAsync(100);
    await ta;
  });

  it('leaves unknown errors unchanged', () => {
    const e = new Error('boom');
    expect(fromNativeError(e, 'tap', 'tap', { id: 'x' })).toBe(e);
    expect(fromNativeError(Object.assign(new Error('no field'), { code: 'E_NOT_TEXT_INPUT' }), 'typeText', 'type', { id: 'x' })).toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
  });

  it('cannot address elements without a native tag', async () => {
    const roots = tree({ testID: 'btn', tag: null });
    const { p } = setup(bridge(), roots);
    await expect(p.tap(roots[0]!)).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
  });
});
