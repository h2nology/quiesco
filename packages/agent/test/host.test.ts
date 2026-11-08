import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hostPerformer } from '../src/actions/host';
import type { Clock } from '../src/sync';
import { tree } from './helpers/nodes';

const clock: Clock = { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as number), now: () => Date.now() };

function setup(roots = tree({ testID: 'btn', rect: { x: 10, y: 100, width: 200, height: 40 } })) {
  const p = hostPerformer({ clock, roots: () => roots, viewport: () => ({ width: 390, height: 844 }), matcher: { id: 'btn' }, deadline: Date.now() + 5000 });
  return { p, node: roots[0]! };
}

async function run<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(50);
  return p;
}

describe('hostPerformer', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('returns taps at the element center (CSS px), with count / hold for double tap / long press', async () => {
    const { p, node } = setup();
    expect(await run(p.tap(node))).toEqual({ kind: 'tap', x: 110, y: 120 });
    expect(await run(p.multiTap(node, 2))).toEqual({ kind: 'tap', x: 110, y: 120, count: 2 });
    expect(await run(p.longPress(node))).toEqual({ kind: 'tap', x: 110, y: 120, holdMs: 800 });
  });

  it('returns keyboard input at the field; clear replaces the content', async () => {
    const { p, node } = setup();
    expect(await run(p.type(node, '买牛奶'))).toEqual({ kind: 'type', x: 110, y: 120, text: '买牛奶', clearFirst: false });
    expect(await run(p.clear(node))).toEqual({ kind: 'type', x: 110, y: 120, text: '', clearFirst: true });
  });

  it('scrolls with the wheel (down = positive dy); a swipe up scrolls content down', async () => {
    const { p, node } = setup(tree({ testID: 'list', rect: { x: 0, y: 0, width: 390, height: 500 } }));
    expect(await run(p.scroll(node, 'down'))).toEqual({ kind: 'wheel', x: 195, y: 250, dx: 0, dy: 400 });
    expect(await run(p.scroll(node, 'left', 100))).toEqual({ kind: 'wheel', x: 195, y: 250, dx: -100, dy: 0 });
    expect(await run(p.swipe(node, 'up'))).toMatchObject({ kind: 'wheel', dy: 400 });
  });

  it('rejects covered elements with ELEMENT_OBSCURED', async () => {
    const roots = tree({ testID: 'btn', rect: { x: 10, y: 100, width: 200, height: 40 } }, { testID: 'cookie-banner', rect: { x: 0, y: 0, width: 390, height: 300 } });
    const { p, node } = setup(roots);
    const r = p.tap(node);
    const a = expect(r).rejects.toMatchObject({ errorName: 'ELEMENT_OBSCURED', data: { obscuredBy: '<RCTView testID="cookie-banner">' } });
    await vi.advanceTimersByTimeAsync(50);
    await a;
  });

  it('is marked as host-injected', () => {
    expect(setup().p.viaHost).toBe(true);
  });
});
