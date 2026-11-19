import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuiescoError } from '../src/errors';
import type { AppDeps } from '../src/platform';
import { AgentRuntime } from '../src/runtime';
import type { Clock, IdleTracker } from '../src/sync';
import { fakeScheduler, host, makeRoot, renderWith, text } from './helpers/fake-fiber';
import { CONFIG, FakeSocket } from './helpers/fake-socket';
import type { Spec } from './helpers/fake-fiber';

const clock: Clock = { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as number), now: () => Date.now() };
const R = (y: number) => ({ __rect: { x: 0, y, width: 100, height: 40 } });

function setup(
  opts: { platform?: 'ios' | 'android' | 'web'; busy?: () => boolean; native?: ReturnType<AppDeps['nativeModule']>; keyboard?: () => ReturnType<AppDeps['keyboardFrame']>; appState?: () => ReturnType<AppDeps['appState']>; globals?: Record<string, unknown>; logBox?: { clearAllLogs(): void; ignoreAllLogs(v?: boolean): void } } = {},
) {
  const target: Record<string, unknown> = { ...opts.globals };
  const sockets: FakeSocket[] = [];
  const deps: AppDeps = {
    platform: () => opts.platform ?? 'android',
    dismissKeyboard: vi.fn(),
    keyboardFrame: () => opts.keyboard?.() ?? null,
    nativeModule: () => opts.native ?? null,
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    interactionManager: () => null,
    appState: () => opts.appState?.() ?? 'active',
    windowInfo: () => ({ width: 400, height: 800, pixelRatio: 3 }),
    settings: () => ({ colorScheme: 'dark', fontScale: 1.235, locale: 'ja-JP' }),
  };
  const storageCleared: number[] = [];
  const tracker: IdleTracker = { name: 'fake', isIdle: () => !(opts.busy?.() ?? false), describeBusy: () => ['fake busy'], install() {}, uninstall() {} };
  const rt = new AgentRuntime({
    globalObject: target,
    deps,
    clock,
    adapter: { loadScheduler: () => fakeScheduler().mod, platformDeps: { getPublicInstance: () => (f) => f.stateNode, viewport: () => ({ width: 400, height: 800 }) } },
    trackers: () => [tracker],
    storage: () => [{ name: 'mem', clear: () => void storageCleared.push(Date.now()) }],
    ...(opts.logBox !== undefined ? { logBox: () => opts.logBox ?? null } : {}),
  });
  rt.installEarly();
  return { rt, deps, sockets, target, storageCleared, call: (m: string, p: unknown) => rt.handle(m, p) };
}

/** Advance fake time so waitForIdle's macrotask confirmation and retries can run. */
async function drive<T>(p: Promise<T>, ms = 100): Promise<T> {
  p.catch(() => {});
  await vi.advanceTimersByTimeAsync(ms);
  return p;
}

/** Re-commit by mutating a single FiberRoot (a real renderer keeps the same root object). */
function sameRoot(target: Record<string, unknown>) {
  const root = makeRoot();
  const id = renderWith(target, root);
  return (...children: Spec[]) => {
    root.current = makeRoot(...children).current;
    (target['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as { onCommitFiberRoot: (i: number, r: unknown) => void }).onCommitFiberRoot(id, root);
  };
}

describe('AgentRuntime', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('connects on mount with launch params from @quiesco/native and applies the config from hello', () => {
    const native = { getLaunchParams: () => ({ port: '7401', session: 'sess' }), locate: vi.fn(), tap: vi.fn(), swipe: vi.fn(), typeText: vi.fn() };
    const { rt, sockets } = setup({ native });
    rt.mount(null);
    expect(sockets[0]?.url).toBe('ws://localhost:7401');
    sockets[0]!.open();
    expect(sockets[0]!.sent[0]).toMatchObject({ params: { sessionId: 'sess', nativeModule: true } });
    sockets[0]!.receive({ jsonrpc: '2.0', id: 'hello', result: { accepted: true, sessionId: 'sess', config: { ...CONFIG, sync: { ...CONFIG.sync, timeoutMs: 1234 } } } });
    expect(rt.config.sync.timeoutMs).toBe(1234);
  });

  it('keeps the connection when QuiescoRoot is unmounted and mounted again in the same commit; stops one tick after the last unmount', async () => {
    const { rt, sockets } = setup();
    rt.mount(null);
    sockets[0]!.open();
    rt.unmount();
    rt.mount(null); // e.g. expo-router remounting the root layout after a soft reset
    await vi.advanceTimersByTimeAsync(10);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.closed).toBeNull();

    rt.unmount();
    expect(sockets[0]!.closed).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets[0]!.closed).toMatchObject({ code: 1000 });
  });

  it('query returns element summaries after waiting for idle', async () => {
    const { target, call } = setup();
    const commit = sameRoot(target);
    commit(host('RCTView', { testID: 'a', ...R(0) }, host('RCTText', {}, text('Hi'))));
    const res = (await drive(call('query', { matcher: { id: 'a' } }))) as { elements: { text: string; visible: boolean }[] };
    expect(res.elements).toEqual([expect.objectContaining({ text: 'Hi', visible: true, testID: 'a' })]);
  });

  it('tap waits for the element to appear, presses it, and returns its summary', async () => {
    const { target, call } = setup();
    const commit = sameRoot(target);
    const onPress = vi.fn();
    const p = call('action', { action: { type: 'tap', matcher: { id: 'go' } }, mode: 'js', timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(200);
    expect(onPress).not.toHaveBeenCalled();
    commit({ tag: 0, type: 'Pressable', props: { onPress }, children: [host('RCTView', { testID: 'go', ...R(10) })] });
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toMatchObject({ element: { testID: 'go' } });
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('tap fails with ELEMENT_NOT_FOUND (not visible) and MULTIPLE_MATCHES', async () => {
    const { target, call } = setup();
    const commit = sameRoot(target);
    commit(host('RCTView', { testID: 'hidden', style: { display: 'none' }, ...R(0) }), host('RCTView', { testID: 'dup', ...R(0) }), host('RCTView', { testID: 'dup', ...R(50) }));
    const p1 = call('action', { action: { type: 'tap', matcher: { id: 'hidden' } }, mode: 'js', timeoutMs: 300 });
    const a1 = expect(p1).rejects.toMatchObject({ errorName: 'ELEMENT_NOT_FOUND', message: expect.stringMatching(/exists but is not visible/) });
    await vi.advanceTimersByTimeAsync(400);
    await a1;
    await expect(drive(call('action', { action: { type: 'tap', matcher: { id: 'dup' } }, mode: 'js' }))).rejects.toSatisfy(
      (e: unknown) => (e as QuiescoError<'MULTIPLE_MATCHES'>).data.matches.length === 2,
    );
  });

  it('native mode without @quiesco/native returns host input; device actions are delegated to the host', async () => {
    const { call, deps, target } = setup();
    sameRoot(target)(host('RCTView', { testID: 'x', ...R(0) }));
    await expect(drive(call('action', { action: { type: 'tap', matcher: { id: 'x' } }, mode: 'native' }))).resolves.toEqual({ syncMs: expect.any(Number),
      element: expect.objectContaining({ testID: 'x' }),
      hostInput: { kind: 'tap', x: 50, y: 20 },
    });
    await expect(call('action', { action: { type: 'pressBack' }, mode: 'js' })).resolves.toEqual({ syncMs: expect.any(Number), hostInput: { kind: 'back' } });
    await expect(call('action', { action: { type: 'openUrl', url: 'app://x' }, mode: 'js' })).resolves.toEqual({ syncMs: expect.any(Number), hostInput: { kind: 'navigate', url: 'app://x' } });
    await expect(drive(call('action', { action: { type: 'dismissKeyboard' }, mode: 'js' }))).resolves.toEqual({ syncMs: expect.any(Number) });
    expect(deps.dismissKeyboard).toHaveBeenCalledOnce();
  });

  it('openUrl goes through the native module when it can open URLs in the app (iOS), in any action mode', async () => {
    const openUrl = vi.fn(async () => ({ opened: true }));
    const native = {
      getLaunchParams: () => ({ port: null, session: null }),
      locate: vi.fn(),
      tap: vi.fn(),
      swipe: vi.fn(),
      typeText: vi.fn(),
      openUrl,
    } as unknown as NonNullable<ReturnType<AppDeps['nativeModule']>>;
    const { call } = setup({ native });
    await expect(drive(call('action', { action: { type: 'openUrl', url: 'app://todos' }, mode: 'js' }))).resolves.toEqual({ syncMs: expect.any(Number) });
    expect(openUrl).toHaveBeenCalledWith('app://todos');

    openUrl.mockResolvedValueOnce({ opened: false });
    await expect(drive(call('action', { action: { type: 'openUrl', url: 'other://x' }, mode: 'native' }))).rejects.toMatchObject({
      errorName: 'ACTION_NOT_SUPPORTED',
      message: expect.stringContaining('other://x'),
    });
    // pressBack stays a host action; the iOS DeviceProvider rejects it.
    await expect(call('action', { action: { type: 'pressBack' }, mode: 'native' })).resolves.toEqual({ syncMs: expect.any(Number), hostInput: { kind: 'back' } });
  });

  it('assert retries until the expectation holds', async () => {
    const { target, call } = setup();
    const commit = sameRoot(target);
    commit(host('RCTText', { testID: 'count', ...R(0) }, text('0')));
    const p = call('assert', { assertion: { type: 'text', matcher: { id: 'count' }, expected: '1' }, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(120);
    commit(host('RCTText', { testID: 'count', ...R(0) }, text('1')));
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toMatchObject({ elements: [{ text: '1' }] });
  });

  it('assert fails with ASSERTION_FAILED carrying expected, actual and elements', async () => {
    const { target, call } = setup();
    sameRoot(target)(host('RCTText', { testID: 'count', ...R(0) }, text('0')));
    const p = call('assert', { assertion: { type: 'text', matcher: { id: 'count' }, expected: '5' }, timeoutMs: 300 });
    const a = expect(p).rejects.toSatisfy((e: unknown) => {
      const err = e as QuiescoError<'ASSERTION_FAILED'>;
      expect(err.toJSON()).toMatchObject({ code: 1004, data: { expected: '5', actual: '0', elements: [{ testID: 'count' }] } });
      expect(err.message).toMatch(/expect text failed after 300ms for \{ id: "count" \}/);
      return true;
    });
    await vi.advanceTimersByTimeAsync(400);
    await a;
  });

  it('action: a missing target is ELEMENT_NOT_FOUND even when the last sync was cut short by the deadline', async () => {
    let busy = false;
    const { target, call } = setup({ busy: () => busy });
    sameRoot(target)(host('RCTView', { testID: 'other', ...R(0) }));
    const p = call('action', { action: { type: 'tap', matcher: { id: 'missing' } }, mode: 'js', timeoutMs: 300 });
    const a = expect(p).rejects.toMatchObject({ errorName: 'ELEMENT_NOT_FOUND', message: expect.stringMatching(/No element matches .*also still busy.*fake busy/s) });
    await vi.advanceTimersByTimeAsync(60);
    busy = true; // the remaining retries cannot get idle before the deadline
    await vi.advanceTimersByTimeAsync(400);
    await a;
  });

  it('action: a sync cut to a few ms by the deadline is not reported as busy; the reason and the route are (issue #2)', async () => {
    let busy = false;
    const { rt, target, call } = setup({ busy: () => busy });
    rt.navigation.setRef({ isReady: () => true, getRootState: () => ({ routes: [{ name: 'students/new' }] }) });
    sameRoot(target)(host('RCTView', { testID: 'cover', style: { display: 'none' }, ...R(0) }, host('RCTView', { testID: 'search', ...R(0) })));
    const p = call('action', { action: { type: 'tap', matcher: { id: 'search' } }, mode: 'js', timeoutMs: 2000 });
    const a = expect(p).rejects.toMatchObject({ errorName: 'ELEMENT_NOT_FOUND' });
    await vi.advanceTimersByTimeAsync(1990);
    busy = true;
    await vi.advanceTimersByTimeAsync(100);
    await a;
    const message = ((await p.catch((e: Error) => e)) as Error).message;
    expect(message).toBe('The element exists but is not visible: { id: "search" }: an ancestor <RCTView testID="cover"> is hidden (display: none or opacity: 0), e.g. a screen that is not on top (current route: /students/new)');
  });

  it('action: a present target in a never-idle app is still SYNC_TIMEOUT', async () => {
    const { target, call } = setup({ busy: () => true });
    sameRoot(target)(host('RCTView', { testID: 'go', onPress: () => {}, ...R(0) }));
    const p = call('action', { action: { type: 'tap', matcher: { id: 'go' } }, mode: 'js', timeoutMs: 300 });
    const a = expect(p).rejects.toMatchObject({ errorName: 'SYNC_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(400);
    await a;
  });

  it('assert: a retry sync cut short by the deadline does not turn ASSERTION_FAILED into SYNC_TIMEOUT', async () => {
    let busy = false;
    const { target, call } = setup({ busy: () => busy });
    sameRoot(target)(host('RCTText', { testID: 'count', ...R(0) }, text('0')));
    const p = call('assert', { assertion: { type: 'text', matcher: { id: 'count' }, expected: '5' }, timeoutMs: 300 });
    const a = expect(p).rejects.toMatchObject({ errorName: 'ASSERTION_FAILED' });
    await vi.advanceTimersByTimeAsync(60); // first sync done: the app was idle
    busy = true; // later retries cannot get idle before the deadline
    await vi.advanceTimersByTimeAsync(400);
    await a;
  });

  it('assert: an app that is never idle still fails with SYNC_TIMEOUT', async () => {
    const { target, call } = setup({ busy: () => true });
    sameRoot(target)(host('RCTText', { testID: 'count', ...R(0) }, text('0')));
    const p = call('assert', { assertion: { type: 'text', matcher: { id: 'count' }, expected: '5' }, timeoutMs: 300 });
    const a = expect(p).rejects.toMatchObject({ errorName: 'SYNC_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(400);
    await a;
  });

  it('propagates SYNC_TIMEOUT unless sync is disabled for the call', async () => {
    const { target, call } = setup({ busy: () => true });
    sameRoot(target)(host('RCTView', { testID: 'a', ...R(0) }));
    const p = call('query', { matcher: { id: 'a' }, timeoutMs: 200 });
    const a = expect(p).rejects.toMatchObject({ errorName: 'SYNC_TIMEOUT', message: expect.stringContaining('fake busy') });
    await vi.advanceTimersByTimeAsync(300);
    await a;
    await expect(drive(call('query', { matcher: { id: 'a' }, sync: false }))).resolves.toMatchObject({ elements: [{ testID: 'a' }] });
  });

  // ---- Phase 6.2 ----

  /** A class component fiber (work tag 1) with `instance` as its stateNode. */
  const classOf = (instance: object, ...children: Spec[]): Spec => ({ tag: 1, type: class List {}, props: {}, stateNode: instance, children });

  it('scrollToIndex: scrolls to the last measured row until the requested row can be reached', async () => {
    const { target, call } = setup();
    let highest = 9;
    const calls: number[] = [];
    const list = {
      props: { data: Array.from({ length: 200 }, (_, i) => i) },
      _listMetrics: { getHighestMeasuredCellIndex: () => highest },
      scrollToIndex({ index }: { index: number }) {
        if (index > highest) throw new Error('scrollToIndex should be used in conjunction with getItemLayout or onScrollToIndexFailed');
        calls.push(index);
        if (index === highest) highest += 20; // the list renders (and measures) more rows
      },
    };
    sameRoot(target)(classOf(list, host('RCTScrollView', { testID: 'list', ...R(0) })));
    await expect(drive(call('action', { action: { type: 'scrollToIndex', matcher: { id: 'list' }, index: 45, viewPosition: 0.5 }, mode: 'native' }), 500)).resolves.toMatchObject({ element: { testID: 'list' } });
    expect(calls).toEqual([9, 29, 45]);
  });

  it('scrollToIndex: reads react-native-web\'s _highestMeasuredFrameIndex', async () => {
    const { target, call } = setup();
    const calls: number[] = [];
    const list = {
      props: { data: Array.from({ length: 100 }, (_, i) => i) },
      _highestMeasuredFrameIndex: 9,
      scrollToIndex({ index }: { index: number }) {
        if (index > list._highestMeasuredFrameIndex) throw new Error('onScrollToIndexFailed');
        calls.push(index);
        if (index === list._highestMeasuredFrameIndex) list._highestMeasuredFrameIndex += 30;
      },
    };
    sameRoot(target)(classOf(list, host('RCTScrollView', { testID: 'list', ...R(0) })));
    await drive(call('action', { action: { type: 'scrollToIndex', matcher: { id: 'list' }, index: 60 }, mode: 'js' }), 500);
    expect(calls).toEqual([9, 39, 60]);
  });

  it('scrollToIndex: out of range and non-list targets fail clearly', async () => {
    const { target, call } = setup();
    const list = { props: { data: [1, 2, 3] }, scrollToIndex: vi.fn() };
    sameRoot(target)(classOf(list, host('RCTScrollView', { testID: 'list', ...R(0) })), host('RCTView', { testID: 'plain', ...R(50) }));
    await expect(drive(call('action', { action: { type: 'scrollToIndex', matcher: { id: 'list' }, index: 3 }, mode: 'js' }))).rejects.toMatchObject({
      errorName: 'ELEMENT_NOT_FOUND',
      message: expect.stringContaining('has 3 rows'),
    });
    await expect(drive(call('action', { action: { type: 'scrollToIndex', matcher: { id: 'plain' }, index: 0 }, mode: 'js' }))).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
    expect(list.scrollToIndex).not.toHaveBeenCalled();
  });

  it('scrollToEdge (js): sets the offset to the end, repeating while the content grows', async () => {
    const { target, call } = setup();
    const viewport = { x: 0, y: 0, width: 300, height: 500 };
    const content = { x: 0, y: 0, width: 300, height: 1000 };
    const scrollView = {
      scrollTo({ y }: { y: number }) {
        content.y = -y;
        if (content.height < 3000) content.height += 1000; // a virtualized list renders more rows
      },
    };
    sameRoot(target)(classOf(scrollView, host('RCTScrollView', { testID: 'sv', __rect: viewport }, host('RCTScrollContentView', { __rect: content }))));
    await drive(call('action', { action: { type: 'scrollToEdge', matcher: { id: 'sv' }, edge: 'bottom' }, mode: 'js' }), 500);
    expect(content).toMatchObject({ height: 3000, y: -2500 });
  });

  it('scrollTo scrolls a horizontal list right / left, not the vertical list around it (#46)', async () => {
    const { target, call } = setup();
    const carousel = { x: 0, y: 100, width: 300, height: 80 };
    const strip = { x: 0, y: 100, width: 2400, height: 80 };
    const slide8 = { x: 1680, y: 100, width: 240, height: 80 };
    const carouselView = {
      scrollTo: vi.fn(({ x }: { x: number }) => {
        strip.x = -x;
        slide8.x = 1680 - x;
      }),
    };
    const listView = { scrollTo: vi.fn() };
    sameRoot(target)(
      classOf(
        listView,
        host(
          'RCTScrollView',
          { testID: 'list', __rect: { x: 0, y: 100, width: 300, height: 600 } },
          host(
            'RCTScrollContentView',
            { __rect: { x: 0, y: 100, width: 300, height: 3000 } },
            classOf(carouselView, host('AndroidHorizontalScrollView', { testID: 'carousel', __rect: carousel }, host('RCTScrollContentView', { __rect: strip }, host('RCTView', { testID: 'slide-8', __rect: slide8 })))),
          ),
        ),
      ),
    );
    await expect(drive(call('action', { action: { type: 'scrollTo', container: { id: 'carousel' }, target: { id: 'slide-8' } }, mode: 'js' }), 1000)).resolves.toMatchObject({ element: { testID: 'slide-8' } });
    // 0.85 × 300 per step until slide 8's center is in the carousel.
    expect(carouselView.scrollTo.mock.calls.map(([a]) => (a as { x: number; y: number }).y)).toEqual(carouselView.scrollTo.mock.calls.map(() => 0));
    expect(slide8.x + slide8.width / 2).toBeLessThan(300);
    expect(listView.scrollTo).not.toHaveBeenCalled();
  });

  it('scrollTo goes on until the center of the target is visible, not a 1 pt sliver of it (#45)', async () => {
    const { target, call } = setup();
    // A list below a header (y 150–200), 400 high: one step is 0.85 × 400 = 340. Row content y 739, 52 high.
    const content = { x: 0, y: 200, width: 300, height: 5000 };
    const row = { x: 0, y: 200 + 739, width: 300, height: 52 };
    const listView = {
      scrollTo: vi.fn(({ y }: { y: number }) => {
        content.y = 200 - y;
        row.y = 200 + 739 - y;
      }),
    };
    sameRoot(target)(
      host('RCTView', { testID: 'header', __rect: { x: 0, y: 150, width: 300, height: 50 } }),
      classOf(listView, host('RCTScrollView', { testID: 'list', __rect: { x: 0, y: 200, width: 300, height: 400 } }, host('RCTScrollContentView', { __rect: content }, host('RCTView', { testID: 'row', __rect: row })))),
    );
    await expect(drive(call('action', { action: { type: 'scrollTo', container: { id: 'list' }, target: { id: 'row' } }, mode: 'js' }), 1000)).resolves.toMatchObject({ element: { testID: 'row' } });
    // After one step the row showed 1 pt (y 599); the second step brings its center in.
    expect(listView.scrollTo.mock.calls.map(([a]) => (a as { y: number }).y)).toEqual([340, 680]);
    expect(row.y).toBe(259);
  });

  it('scrollView (6.9 full-page screenshots): the largest visible one by default, or the one around an element; scrolls it when asked', async () => {
    const { target, call } = setup();
    const big = { x: 0, y: 100, width: 300, height: 500 };
    const bigContent = { x: 0, y: 100, width: 300, height: 1500 };
    const small = { x: 0, y: 0, width: 300, height: 80 };
    const bigView = { scrollTo: vi.fn(({ y }: { y: number }) => void (bigContent.y = big.y - y)) };
    const smallView = { scrollTo: vi.fn() };
    sameRoot(target)(
      classOf(smallView, host('RCTScrollView', { testID: 'tabs', __rect: small }, host('RCTScrollContentView', { __rect: { x: 0, y: 0, width: 600, height: 80 } }))),
      classOf(bigView, host('RCTScrollView', { testID: 'feed', __rect: big }, host('RCTScrollContentView', { __rect: bigContent }, host('RCTView', { testID: 'row', ...R(130) })))),
    );
    expect(await drive(call('scrollView', {}))).toEqual({ rect: big, offset: { x: 0, y: 0 }, content: { width: 300, height: 1500 }, syncMs: expect.any(Number) });
    expect(await drive(call('scrollView', { matcher: { id: 'row' }, to: { x: 0, y: 400 } }))).toMatchObject({ offset: { x: 0, y: 400 } });
    expect(bigView.scrollTo).toHaveBeenCalledWith({ x: 0, y: 400, animated: false });
    expect(smallView.scrollTo).not.toHaveBeenCalled();
  });

  it('a point outside the element is rejected; pressKey reaches a field that is not visible', async () => {
    const { target, call } = setup();
    const onSubmitEditing = vi.fn();
    sameRoot(target)(
      host('RCTView', { testID: 'box', onPress: () => {}, ...R(0) }),
      host('AndroidTextInput', { testID: 'offscreen', onSubmitEditing, onChangeText: () => {}, value: 'x', __rect: { x: 0, y: 5000, width: 100, height: 40 } }),
    );
    await expect(drive(call('action', { action: { type: 'tap', matcher: { id: 'box' }, point: { x: 150, y: 10 } }, mode: 'js' }))).rejects.toMatchObject({
      errorName: 'ACTION_NOT_SUPPORTED',
      message: expect.stringContaining('outside the element (100×40)'),
    });
    await drive(call('action', { action: { type: 'pressKey', matcher: { id: 'offscreen' }, key: 'enter' }, mode: 'js' }));
    expect(onSubmitEditing).toHaveBeenCalledOnce();
  });

  it('drag to an element: the host gets a drag to its center (web)', async () => {
    const { target, call } = setup();
    sameRoot(target)(host('RCTView', { testID: 'card', ...R(0) }), host('RCTView', { testID: 'slot', __rect: { x: 0, y: 300, width: 200, height: 100 } }));
    await expect(drive(call('action', { action: { type: 'drag', matcher: { id: 'card' }, to: { matcher: { id: 'slot' } }, speed: 'fast' }, mode: 'native' }))).resolves.toMatchObject({
      hostInput: { kind: 'drag', from: { x: 50, y: 20 }, to: { x: 100, y: 350 }, durationMs: 250, holdMs: 800 },
    });
  });

  it('getTree / getIdleState / unknown methods', async () => {
    const { target, call } = setup();
    sameRoot(target)(host('RCTView', { testID: 'a', ...R(0) }));
    await expect(call('getTree', {})).resolves.toMatchObject({ root: { type: 'RCTView', testID: 'a' } });
    await expect(call('getIdleState', {})).resolves.toEqual({ trackers: [{ name: 'fake', idle: true, busy: [] }] });
    await expect(call('nope', {})).rejects.toThrow('unknown method nope');
  });

  it('backdoor runs the registered function and waits for idle afterwards', async () => {
    let busy = false;
    const { rt, call } = setup({ busy: () => busy });
    rt.backdoors.register('loginAs', (email: string) => {
      busy = true;
      setTimeout(() => (busy = false), 300);
      return { email };
    });
    let done = false;
    const p = call('backdoor', { name: 'loginAs', args: ['a@example.com'] }).then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(false); // still waiting for the app to settle
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toEqual({ value: { email: 'a@example.com' } });
  });

  it('reset clears storage, runs hooks, remounts via QuiescoRoot and reports the duration', async () => {
    const { rt, call, storageCleared } = setup();
    const order: string[] = [];
    rt.resets.onReset(() => void order.push('hook'));
    const off = rt.setRemount(() => order.push('remount'));
    await expect(drive(call('reset', {}))).resolves.toEqual({ durationMs: expect.any(Number) });
    expect(storageCleared).toHaveLength(1);
    expect(order).toEqual(['hook', 'remount']);
    off();
    await expect(drive(call('reset', {}))).rejects.toMatchObject({ errorName: 'RESET_FAILED', data: { step: 'remount' } });
  });

  it('LogBox: cleared before each soft reset, notifications off with ignore, left alone with keep (issue #31)', async () => {
    const calls: string[] = [];
    const logBox = { clearAllLogs: () => void calls.push('clear'), ignoreAllLogs: (v?: boolean) => void calls.push(`ignore:${String(v)}`) };
    const { rt, call } = setup({ logBox });
    rt.resets.onReset(() => void calls.push('hook'));
    rt.setRemount(() => calls.push('remount'));
    const config = (logBox?: 'clear' | 'ignore' | 'keep') => ({ ...rt.config, ...(logBox !== undefined ? { logBox } : {}) });
    rt.configure(config('clear'));
    await drive(call('reset', {}));
    expect(calls).toEqual(['clear', 'hook', 'remount']);
    calls.length = 0;
    rt.configure(config('ignore'));
    rt.configure(config('ignore')); // once
    await drive(call('reset', {}));
    expect(calls).toEqual(['ignore:true', 'clear', 'hook', 'remount']);
    calls.length = 0;
    rt.configure(config('keep')); // turns notifications back on, and no more clearing
    await drive(call('reset', {}));
    expect(calls).toEqual(['ignore:false', 'hook', 'remount']);
    calls.length = 0;
    rt.configure(config()); // an older host: keep
    await drive(call('reset', {}));
    expect(calls).toEqual(['hook', 'remount']);
  });

  it('a failing LogBox fails neither the configuration nor the reset', async () => {
    const broken = { clearAllLogs: () => { throw new Error('no LogBox'); }, ignoreAllLogs: () => { throw new Error('no LogBox'); } };
    const { rt, call } = setup({ logBox: broken });
    rt.setRemount(() => {});
    expect(() => rt.configure({ ...rt.config, logBox: 'ignore' })).not.toThrow();
    await expect(drive(call('reset', {}))).resolves.toEqual({ durationMs: expect.any(Number) });
  });

  it('reset puts the Expo Router state back before the remount, reports the route and fails when the app wanders off (issue #1)', async () => {
    const { rt, call } = setup();
    const order: string[] = [];
    const initial = { index: 0, routes: [{ name: '__root', state: { index: 0, routes: [{ name: 'index' }] } }] };
    const pushed = { index: 0, routes: [{ name: '__root', state: { index: 1, routes: [{ name: 'index' }, { name: 'students/new' }] } }] };
    let state: object = initial;
    let redirect: object | null = null;
    rt.navigation.setRef({
      isReady: () => true,
      getRootState: () => state as never,
      resetRoot: (s) => {
        order.push('navigation');
        state = s as object;
      },
    });
    rt.resets.onReset(() => void order.push('hook'));
    rt.setRemount(() => {
      order.push('remount');
      if (redirect !== null) state = redirect; // e.g. a screen that navigates on mount from uncleared state
    });
    await expect(call('route', {})).resolves.toEqual({ route: '/' });
    state = pushed;
    await expect(call('route', {})).resolves.toEqual({ route: '/students/new' });
    await expect(drive(call('reset', {}))).resolves.toEqual({ durationMs: expect.any(Number), route: '/' });
    expect(order).toEqual(['hook', 'navigation', 'remount']);
    expect(state).toEqual(initial);
    redirect = pushed;
    await expect(drive(call('reset', {}))).rejects.toMatchObject({ errorName: 'RESET_FAILED', data: { step: 'navigation', message: expect.stringMatching(/on \/students\/new after the soft reset, not on its initial route \//) } });
  });

  it('goBack closes the keyboard first, then hands the back to the host (issue #4)', async () => {
    let keyboard: { x: number; y: number; width: number; height: number } | null = { x: 0, y: 500, width: 400, height: 300 };
    const { deps, call } = setup({ keyboard: () => keyboard });
    vi.mocked(deps.dismissKeyboard).mockImplementation(() => void (keyboard = null));
    await expect(drive(call('action', { action: { type: 'goBack' }, mode: 'native' }))).resolves.toMatchObject({ hostInput: { kind: 'goBack' } });
    expect(deps.dismissKeyboard).toHaveBeenCalledTimes(1);
    await expect(drive(call('action', { action: { type: 'goBack' }, mode: 'native' }))).resolves.toMatchObject({ hostInput: { kind: 'goBack' } });
    expect(deps.dismissKeyboard).toHaveBeenCalledTimes(1);
  });

  it('route is null and reset has no navigation step without Expo Router', async () => {
    const { rt, call } = setup();
    rt.setRemount(() => {});
    await expect(call('route', {})).resolves.toEqual({ route: null });
    await expect(drive(call('reset', {}))).resolves.toEqual({ durationMs: expect.any(Number) });
  });

  it('native mode taps through @quiesco/native using the native view tag', async () => {
    const native = {
      getLaunchParams: () => ({ port: null, session: null }),
      locate: vi.fn(async () => ({ found: true, x: 0, y: 10, width: 100, height: 40, windowHasFocus: true })),
      tap: vi.fn(async () => ({ handled: true })),
      swipe: vi.fn(),
      typeText: vi.fn(),
    };
    const { call, target } = setup({ native });
    sameRoot(target)(host('RCTView', { testID: 'go', ...R(10) }));
    await expect(drive(call('action', { action: { type: 'tap', matcher: { id: 'go' } }, mode: 'native' }))).resolves.toMatchObject({ element: { testID: 'go' } });
    expect(native.tap).toHaveBeenCalledWith(expect.any(Number), 0, 0, 50, 1);
  });

  it('native mode dismisses a software keyboard that covers the target, then taps it', async () => {
    let keyboard: { x: number; y: number; width: number; height: number } | null = { x: 0, y: 500, width: 400, height: 300 };
    const native = {
      getLaunchParams: () => ({ port: null, session: null }),
      locate: vi.fn(async () => ({ found: true, x: 0, y: 520, width: 100, height: 40, windowHasFocus: true })),
      tap: vi.fn(async () => ({ handled: true })),
      swipe: vi.fn(),
      typeText: vi.fn(),
    };
    const { call, deps, target } = setup({ native, keyboard: () => keyboard });
    const order: string[] = [];
    vi.mocked(deps.dismissKeyboard).mockImplementation(() => {
      order.push('dismiss');
      keyboard = null;
    });
    native.tap.mockImplementation(async () => {
      order.push('tap');
      return { handled: true };
    });
    sameRoot(target)(host('RCTView', { testID: 'save', ...R(520) }), host('RCTView', { testID: 'top', ...R(10) }));
    await expect(drive(call('action', { action: { type: 'tap', matcher: { id: 'save' } }, mode: 'native' }))).resolves.toMatchObject({ element: { testID: 'save' } });
    expect(order).toEqual(['dismiss', 'tap']);
    // not covered: the keyboard stays
    keyboard = { x: 0, y: 500, width: 400, height: 300 };
    await drive(call('action', { action: { type: 'tap', matcher: { id: 'top' } }, mode: 'native' }));
    expect(deps.dismissKeyboard).toHaveBeenCalledOnce();
    // js mode calls the handler directly: no touch to block
    await drive(call('action', { action: { type: 'tap', matcher: { id: 'save' } }, mode: 'js' })).catch(() => undefined);
    expect(deps.dismissKeyboard).toHaveBeenCalledOnce();
  });

  it('setValue on a component without a host of its own (Android DateTimePicker) calls its onChange', async () => {
    const { target, call } = setup();
    const commit = sameRoot(target);
    const onChange = vi.fn();
    function DateTimePicker() {
      return null;
    }
    commit(host('RCTView', { testID: 'screen', ...R(0) }), { tag: 0, type: DateTimePicker, props: { testID: 'when', value: new Date(0), onChange }, children: [] });
    const d = new Date(2027, 2, 8, 12);
    await expect(drive(call('action', { action: { type: 'setValue', matcher: { id: 'when' }, value: { date: d.toISOString() } }, mode: 'native', timeoutMs: 1000 }))).resolves.toEqual({ syncMs: expect.any(Number) });
    // a date picker (the default mode): the picked day at the value's time, as the native dialog does
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'set' }), new Date(2027, 2, 8, new Date(0).getHours(), new Date(0).getMinutes()));
    // Only id / type / index matchers reach such components.
    await expect(drive(call('action', { action: { type: 'setValue', matcher: { id: 'when', text: 'x' }, value: 1 }, mode: 'js', timeoutMs: 300 }), 400)).rejects.toMatchObject({ errorName: 'ELEMENT_NOT_FOUND' });
  });

  describe("setValue on @expo/ui's DateTimePicker (issue #29)", () => {
    function DateTimePicker() {
      return null;
    }
    function Host() {
      return null;
    }
    function NativePicker() {
      return null;
    }
    const rect = (x: number, y: number, width: number, height: number) => ({ __rect: { x, y, width, height } });
    const SCREEN = rect(0, 0, 400, 800);
    /** <DateTimePicker testID> → Host → a host view → NativePicker → the native view, as @expo/ui renders it. */
    const picker = (o: { onValueChange: () => void; hostRect: Record<string, unknown>; viewRect?: Record<string, unknown>; viewTestID?: string }) => ({
      tag: 0,
      type: DateTimePicker,
      props: { testID: 'birthday-picker', value: new Date(2000, 0, 1, 9, 30), onValueChange: o.onValueChange },
      children: [
        {
          tag: 0,
          type: Host,
          props: {},
          children: [
            host('ViewManagerAdapter_ExpoUI_HostView', o.hostRect, ...(o.viewRect !== undefined ? [{ tag: 0, type: NativePicker, props: { testID: o.viewTestID, selection: new Date(), onDateChange: () => {} }, children: [host('ViewManagerAdapter_ExpoUI_DatePickerView', { testID: o.viewTestID, ...o.viewRect })] }] : [])),
          ],
        },
      ],
    });
    const setBirthday = (call: (m: string, p: unknown) => Promise<unknown>, mode: 'native' | 'js' = 'native', timeoutMs = 1000) =>
      call('action', { action: { type: 'setValue', matcher: { id: 'birthday-picker' }, value: '2012-05-20' }, mode, timeoutMs });
    const picked = new Date(2012, 4, 20, 9, 30);

    it('iOS: the testID is on a view that reports no height; the Host around it shows it', async () => {
      const { target, call } = setup({ platform: 'ios' });
      const onValueChange = vi.fn();
      sameRoot(target)(host('RCTView', SCREEN, picker({ onValueChange, hostRect: rect(16, 100, 370, 216), viewRect: rect(16, 100, 370, 0), viewTestID: 'birthday-picker' })));
      await expect(drive(setBirthday(call))).resolves.toMatchObject({ element: { testID: 'birthday-picker' } });
      expect(onValueChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'set' }), picked);
    });

    it('Android inline under alignItems: center: the view is 0×0 and the Host 0 wide; the parent shows it', async () => {
      const { target, call } = setup();
      const onValueChange = vi.fn();
      sameRoot(target)(host('RCTView', SCREEN, host('RCTView', rect(0, 200, 400, 122), picker({ onValueChange, hostRect: rect(200, 200, 0, 122), viewRect: rect(200, 200, 0, 0), viewTestID: 'birthday-picker' }))));
      await expect(drive(setBirthday(call, 'js'))).resolves.toMatchObject({ element: { testID: 'birthday-picker' } });
      expect(onValueChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'set' }), picked);
    });

    it('Android dialog: no host has the testID and the Host is 0 high; the component is found by its own testID', async () => {
      const { target, call } = setup();
      const onValueChange = vi.fn();
      sameRoot(target)(host('RCTView', SCREEN, picker({ onValueChange, hostRect: rect(16, 175, 379, 0) })));
      await expect(drive(setBirthday(call))).resolves.toEqual({ syncMs: expect.any(Number) });
      expect(onValueChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'set' }), picked);
    });

    it('still fails where the picker is really not visible, and for a sizeless element that is no value control', async () => {
      const { target, call } = setup({ platform: 'ios' });
      const commit = sameRoot(target);
      const onValueChange = vi.fn();
      // the Host is below the window
      commit(host('RCTView', SCREEN, picker({ onValueChange, hostRect: rect(16, 900, 370, 216), viewRect: rect(16, 900, 370, 0), viewTestID: 'birthday-picker' })));
      await expect(drive(setBirthday(call, 'native', 300), 400)).rejects.toMatchObject({ errorName: 'ELEMENT_NOT_FOUND', message: expect.stringContaining('not visible') });
      // a 0-high view with a testID and no control around it
      commit(host('RCTView', SCREEN, host('RCTView', { testID: 'birthday-picker', onLayout: () => {}, ...rect(16, 100, 370, 0) })));
      await expect(drive(setBirthday(call, 'native', 300), 400)).rejects.toMatchObject({ errorName: 'ELEMENT_NOT_FOUND', message: expect.stringContaining('it has no size (370×0)') });
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  it('accessibilityAction reaches an element that is not on screen; adjustSlider rejects non-sliders', async () => {
    const { target, call } = setup();
    const commit = sameRoot(target);
    const onAccessibilityAction = vi.fn();
    commit(
      host('RCTView', { testID: 'stepper', accessibilityActions: [{ name: 'increment' }], onAccessibilityAction, __rect: { x: 0, y: 5000, width: 10, height: 10 } }),
      { tag: 0, type: 'Switch', props: { value: false, onValueChange: () => {} }, children: [host('RCTSwitch', { testID: 'sw', ...R(0) })] },
    );
    await drive(call('action', { action: { type: 'accessibilityAction', matcher: { id: 'stepper' }, name: 'increment' }, mode: 'js', timeoutMs: 1000 }));
    expect(onAccessibilityAction).toHaveBeenCalledWith({ nativeEvent: { actionName: 'increment' } });
    await expect(drive(call('action', { action: { type: 'adjustSlider', matcher: { id: 'sw' }, position: 0.5 }, mode: 'js', timeoutMs: 1000 }))).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', message: expect.stringContaining('not a slider (found a switch)') });
  });

});

describe('AgentRuntime lifecycle (Phase 6.5)', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  const native = (args?: string | null, suspend?: () => Promise<boolean>) => ({
    getLaunchParams: () => ({ port: '7401', session: 'sess', ...(args !== undefined ? { args } : {}) }),
    locate: vi.fn(),
    tap: vi.fn(),
    swipe: vi.fn(),
    typeText: vi.fn(),
    ...(suspend !== undefined ? { suspend } : {}),
  });

  it('reads typed launch arguments from @quiesco/native (base64 JSON), once', () => {
    const json = JSON.stringify({ user: 'ann', retries: 3, flags: { beta: true }, list: [1, null] });
    const getLaunchParams = vi.fn(() => ({ port: '7401', session: 'sess', args: Buffer.from(json).toString('base64') }));
    const { rt, target } = setup({ native: { ...native(), getLaunchParams } });
    target['atob'] = (b: string) => Buffer.from(b, 'base64').toString('binary');
    expect(rt.launchArgs()).toEqual({ user: 'ann', retries: 3, flags: { beta: true }, list: [1, null] });
    expect(rt.launchArgs()).toEqual({ user: 'ann', retries: 3, flags: { beta: true }, list: [1, null] });
    expect(getLaunchParams).toHaveBeenCalledTimes(1);
  });

  it('returns {} without launch arguments (JS-only build, or a native build launched without them)', () => {
    expect(setup().rt.launchArgs()).toEqual({});
    expect(setup({ native: native(null) }).rt.launchArgs()).toEqual({});
  });

  it('workerIndex() is null until the host sends its config, then the worker it serves (Phase 6.12)', () => {
    const { rt } = setup();
    expect(rt.workerIndex()).toBeNull();
    rt.configure({ ...rt.config, workerIndex: 2 });
    expect(rt.workerIndex()).toBe(2);
    // Older hosts send no index: the only worker.
    rt.configure({ sync: rt.config.sync, logLevel: 'warn' });
    expect(rt.workerIndex()).toBe(0);
  });

  it('configure replaces the agent config at runtime (tracker switches, ignoreUrls)', async () => {
    const { rt, call } = setup();
    await call('configure', { config: { ...CONFIG, sync: { ...CONFIG.sync, trackers: { fake: false } as never, timeoutMs: 777 } } });
    expect(rt.config.sync.timeoutMs).toBe(777);
    expect(await call('getIdleState', {})).toEqual({ trackers: [] });
  });

  it('deviceInfo reports the window, pixel ratio and app state', async () => {
    const { call } = setup({ appState: () => 'background' });
    expect(await call('deviceInfo', {})).toEqual({ window: { width: 400, height: 800 }, pixelRatio: 3, appState: 'background', colorScheme: 'dark', fontScale: 1.235, locale: 'ja-JP' });
  });

  it('setOrientation asks @quiesco/native (iOS) and reports what it said; unsupported without it', async () => {
    const rotate = vi.fn(async (landscape: boolean) => (landscape ? '' : 'The requested orientation is not supported'));
    const s = setup({ native: { ...native(), setOrientation: rotate } });
    expect(await s.call('setOrientation', { orientation: 'landscape' })).toEqual({ supported: true });
    expect(await s.call('setOrientation', { orientation: 'portrait' })).toEqual({ supported: true, error: 'The requested orientation is not supported' });
    expect(rotate.mock.calls).toEqual([[true], [false]]);
    expect(await setup().call('setOrientation', { orientation: 'landscape' })).toEqual({ supported: false });
  });

  it('getClipboard / setClipboard go through @quiesco/native; unsupported without it', async () => {
    let clip = 'before';
    const s = setup({
      native: {
        ...native(),
        getClipboard: async () => clip,
        setClipboard: async (t: string) => {
          clip = t;
        },
      },
    });
    expect(await s.call('getClipboard', {})).toEqual({ supported: true, text: 'before' });
    expect(await s.call('setClipboard', { text: 'こんにちは' })).toEqual({ supported: true });
    expect(clip).toBe('こんにちは');
    expect(await setup().call('getClipboard', {})).toEqual({ supported: false });
    expect(await setup().call('setClipboard', { text: 'x' })).toEqual({ supported: false });
  });

  it('configure switches simulated offline mode; the agent’s own connection stays exempt', async () => {
    const opened: string[] = [];
    const s = setup({ globals: { fetch: async (url: string) => void opened.push(url) } });
    const fetch = s.target['fetch'] as (u: string) => Promise<void>;
    s.rt.mount({});
    await s.call('configure', { config: { ...CONFIG, network: { offline: true } } });
    await fetch('http://localhost:3001/todos');
    await fetch(`http://localhost:${s.rt.client?.url.split(':').pop() ?? ''}/own`);
    await s.call('configure', { config: CONFIG });
    await fetch('http://localhost:3001/todos');
    expect(opened).toEqual(['http://offline.quiesco.invalid/', expect.stringMatching(/^http:\/\/localhost:\d+\/own$/), 'http://localhost:3001/todos']);
  });

  it('suspend uses @quiesco/native when it can, else reports false', async () => {
    const suspend = vi.fn(async () => true);
    expect(await setup({ native: native(undefined, suspend) }).call('suspend', {})).toEqual({ suspended: true });
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(await setup().call('suspend', {})).toEqual({ suspended: false });
  });
});

describe('AgentRuntime webview (Phase 6.8)', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  const bridge = (over: Record<string, unknown> = {}) => ({
    getLaunchParams: () => ({ port: '7401', session: 'sess' }),
    locate: vi.fn(),
    tap: vi.fn(),
    swipe: vi.fn(),
    typeText: vi.fn(),
    webviewInfo: vi.fn(async () => ({ found: true, x: 0, y: 100, width: 390, height: 600, insetTop: 4, insetLeft: 0, loading: false })),
    webviewEval: vi.fn(async (_tag: number, script: string) => `ran:${script}`),
    webviewAddStartScript: vi.fn(async (_tag: number, _source: string) => true),
    ...over,
  });

  it('evaluates the script in the only WebView on screen; registers the page hook once per WebView', async () => {
    const native = bridge();
    const { target, call } = setup({ native });
    sameRoot(target)(host('RCTView', { testID: 'page', ...R(0) }, host('RNCWebView', { testID: 'help', ...R(100) })));
    const r = await drive(call('webview', { script: 'document.title' }));
    // The content rect comes from the native view, below its inset.
    expect(r).toEqual({ syncMs: expect.any(Number), rect: { x: 0, y: 104, width: 390, height: 600 }, loading: false, value: 'ran:document.title' });
    await drive(call('webview', { matcher: { id: 'help' }, script: '1' }));
    expect(native.webviewAddStartScript).toHaveBeenCalledTimes(1);
    expect(native.webviewAddStartScript.mock.calls[0]?.[1]).toContain('__quiescoPending');
  });

  it('several WebViews need a matcher; none fails with ELEMENT_NOT_FOUND after the timeout', async () => {
    const { target, call } = setup({ native: bridge() });
    const commit = sameRoot(target);
    commit(host('RNCWebView', { testID: 'a', ...R(0) }), host('RNCWebView', { testID: 'b', ...R(50) }));
    await expect(drive(call('webview', { script: '1' }))).rejects.toMatchObject({ errorName: 'MULTIPLE_MATCHES' });
    commit(host('RCTView', { testID: 'nothing', ...R(0) }));
    await expect(drive(call('webview', { script: '1', timeoutMs: 300 }), 1000)).rejects.toMatchObject({ errorName: 'ELEMENT_NOT_FOUND', message: expect.stringMatching(/No WebView on screen/) });
  });

  it('needs @quiesco/native on iOS / Android; on the web the host evaluates in the iframe', async () => {
    const plain = setup();
    sameRoot(plain.target)(host('RNCWebView', { testID: 'help', ...R(0) }));
    await expect(drive(plain.call('webview', { script: '1' }))).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', data: { action: 'webview' } });

    const web = setup({ platform: 'web' });
    sameRoot(web.target)(host('div', { testID: 'help-box', ...R(0) }, host('iframe', { ...R(10) })));
    expect(await drive(web.call('webview', { matcher: { id: 'help-box' }, script: '1' }))).toEqual({ syncMs: expect.any(Number), rect: { x: 0, y: 10, width: 100, height: 40 }, viaHost: true });
  });

  it('reports a native WebView without its content and evaluation failures', async () => {
    const empty = setup({ native: bridge({ webviewInfo: vi.fn(async () => ({ found: false })) }) });
    sameRoot(empty.target)(host('RNCWebView', { ...R(0) }));
    await expect(drive(empty.call('webview', { script: '1' }))).rejects.toMatchObject({ errorName: 'ELEMENT_NOT_FOUND' });

    const failing = setup({ native: bridge({ webviewEval: vi.fn(async () => Promise.reject(new Error('boom'))) }) });
    sameRoot(failing.target)(host('RNCWebView', { ...R(0) }));
    await expect(drive(failing.call('webview', { script: '1' }))).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', message: expect.stringMatching(/boom/) });
  });
});
