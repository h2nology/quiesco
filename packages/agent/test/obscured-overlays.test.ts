/** Issue #38: what React Native draws over the app outside <QuiescoRoot> (LogBox's toast) covers it too. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hostPerformer } from '../src/actions/host';
import type { NativeBridge } from '../src/actions/native';
import { nativePerformer } from '../src/actions/native';
import type { Clock } from '../src/sync';
import type { NodeSpec } from './helpers/nodes';
import { tree } from './helpers/nodes';

const clock: Clock = { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as number), now: () => Date.now() };
const viewport = () => ({ width: 411, height: 914 });

const BOTTOM = { x: 0, y: 826, width: 411, height: 64 };
/** The app under QuiescoRoot, with a button pinned to the bottom of the screen. */
const app = (): NodeSpec => ({ type: 'RCTView', rect: { x: 0, y: 0, width: 411, height: 914 }, children: [{ testID: 'bottom', tag: 5, rect: BOTTOM }] });
/** React Native's AppContainer around it: the debugging overlay (pointerEvents none), then LogBox's toast. */
const debugOverlay = (): NodeSpec => ({ type: 'RCTView', props: { pointerEvents: 'none' }, rect: { x: 0, y: 0, width: 411, height: 914 }, children: [{ type: 'DebuggingOverlay', rect: { x: 0, y: 0, width: 411, height: 914 } }] });
const logBoxToast = (): NodeSpec => ({
  type: 'SafeAreaView',
  ownerNames: ['LogBoxNotificationContainer'],
  rect: { x: 10, y: 793, width: 392, height: 102 },
  children: [{ type: 'RCTView', ownerNames: ['LogBoxLogNotification'], rect: { x: 10, y: 817, width: 392, height: 48 }, children: [{ type: 'RCTText', text: 'an app error for #38', rect: { x: 61, y: 830, width: 304, height: 23 } }] }],
});

function bridge(): NativeBridge {
  return {
    locate: vi.fn(async () => ({ found: true, x: BOTTOM.x, y: BOTTOM.y, width: BOTTOM.width, height: BOTTOM.height, windowHasFocus: true })),
    tap: vi.fn(async () => ({ handled: true })),
    swipe: vi.fn(async () => ({ handled: true })),
    typeText: vi.fn(async () => ({ text: '' })),
  };
}

/** The scoped tree (what targets are found in) and the whole app (what the hit test sees), sharing the app's nodes. */
function setup(...around: NodeSpec[]) {
  const appSpec = app();
  const scoped = tree(appSpec);
  const whole = tree({ type: 'RCTView', rect: { x: 0, y: 0, width: 411, height: 914 }, props: { pointerEvents: 'box-none' }, children: [appSpec, ...around] });
  const target = scoped[0]!.children[0]!;
  return { scoped, whole, target };
}

async function run<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  await vi.advanceTimersByTimeAsync(200);
  return p;
}

type Failure = Error & { errorName: string; data: Record<string, unknown> };

/** The error `p` rejects with (the test fails if it resolves). */
async function failure(p: Promise<unknown>): Promise<Failure> {
  try {
    await run(p);
  } catch (e) {
    return e as Failure;
  }
  throw new Error('expected the action to fail');
}

describe('obscured by what is drawn outside <QuiescoRoot> (issue #38)', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  const native = (b: NativeBridge, s: ReturnType<typeof setup>) =>
    nativePerformer({ bridge: b, clock, roots: () => s.scoped, hitRoots: () => s.whole, viewport, action: 'tap', matcher: { id: 'bottom' }, deadline: Date.now() + 1000 });

  it("native: LogBox's toast over the target fails with ELEMENT_OBSCURED naming LogBox, before any touch", async () => {
    const s = setup(debugOverlay(), logBoxToast());
    const b = bridge();
    const e = await failure(native(b, s).tap(s.target));
    expect(e).toMatchObject({ errorName: 'ELEMENT_OBSCURED' });
    expect(e.message).toBe(
      `<RCTView testID="bottom"> is covered by React Native's LogBox <RCTView text="an app error for #38">: the toast a console.error opened (appErrors.logBox: 'clear', the default, removes it on every soft reset; fix the error in the app); a real touch would not reach it`,
    );
    expect(b.tap).not.toHaveBeenCalled();
  });

  it('iOS: when the native hit test reports the cover, LogBox is still named, with the native data', async () => {
    const s = setup(logBoxToast());
    const b: NativeBridge = {
      ...bridge(),
      hitAt: vi.fn(async () => ({ windowHasFocus: false, hitClass: 'RCTParagraphComponentView', hitTags: [999] })),
    };
    const p = nativePerformer({ bridge: b, clock, roots: () => s.scoped, hitRoots: () => s.whole, viewport, action: 'tap', matcher: { id: 'bottom' }, deadline: Date.now() + 1000 });
    const e = await failure(p.tap(s.target, { x: 205, y: 32 }));
    expect(e.message).toContain("is covered by React Native's LogBox");
    expect(e.data['native']).toMatchObject({ hitClass: 'RCTParagraphComponentView' });
    // a native cover React does not know (another window): the generic message as before
    const plain = setup();
    const p2 = nativePerformer({ bridge: b, clock, roots: () => plain.scoped, hitRoots: () => plain.whole, viewport, action: 'tap', matcher: { id: 'bottom' }, deadline: Date.now() + 1000 });
    expect((await failure(p2.tap(plain.target, { x: 205, y: 32 }))).message).toContain('another window or native view, e.g. a Modal, dialog or navigation bar (the touch would reach RCTParagraphComponentView)');
  });

  it('the debugging overlay (pointerEvents none) and the box-none containers cover nothing', async () => {
    const s = setup(debugOverlay());
    const b = bridge();
    await run(native(b, s).tap(s.target));
    expect(b.tap).toHaveBeenCalledOnce();
  });

  it('another element drawn over the app outside <QuiescoRoot> is reported as such; without hitRoots only the scope counts', async () => {
    const banner: NodeSpec = { type: 'RCTView', testID: 'promo-banner', rect: { x: 0, y: 800, width: 411, height: 114 } };
    const s = setup(banner);
    const e = await failure(native(bridge(), s).tap(s.target));
    expect(e.message).toContain('is covered by <RCTView testID="promo-banner">, drawn over the app outside <QuiescoRoot>; a real touch would not reach it');
    // an older caller without hitRoots: as before
    const b = bridge();
    await run(nativePerformer({ bridge: b, clock, roots: () => s.scoped, viewport, action: 'tap', matcher: { id: 'bottom' }, deadline: Date.now() + 1000 }).tap(s.target));
    expect(b.tap).toHaveBeenCalledOnce();
  });

  it('host-injected input (web, or no native module) checks the whole app too', async () => {
    const s = setup(logBoxToast());
    const p = hostPerformer({ clock, roots: () => s.scoped, hitRoots: () => s.whole, viewport, matcher: { id: 'bottom' }, deadline: Date.now() + 1000 });
    const e = await failure(p.tap(s.target));
    expect(e).toMatchObject({ errorName: 'ELEMENT_OBSCURED', data: { obscuredBy: expect.stringMatching(/^React Native's LogBox <RCTView text="an app error for #38">/) } });
  });
});
