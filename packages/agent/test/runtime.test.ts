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

function setup(opts: { busy?: () => boolean; native?: ReturnType<AppDeps['nativeModule']>; keyboard?: () => ReturnType<AppDeps['keyboardFrame']>; appState?: () => ReturnType<AppDeps['appState']> } = {}) {
  const target: Record<string, unknown> = {};
  const sockets: FakeSocket[] = [];
  const deps: AppDeps = {
    platform: () => 'android',
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
    await expect(drive(call('action', { action: { type: 'tap', matcher: { id: 'x' } }, mode: 'native' }))).resolves.toEqual({
      element: expect.objectContaining({ testID: 'x' }),
      hostInput: { kind: 'tap', x: 50, y: 20 },
    });
    await expect(call('action', { action: { type: 'pressBack' }, mode: 'js' })).resolves.toEqual({ hostInput: { kind: 'back' } });
    await expect(call('action', { action: { type: 'openUrl', url: 'app://x' }, mode: 'js' })).resolves.toEqual({ hostInput: { kind: 'navigate', url: 'app://x' } });
    await expect(drive(call('action', { action: { type: 'dismissKeyboard' }, mode: 'js' }))).resolves.toEqual({});
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
    await expect(drive(call('action', { action: { type: 'openUrl', url: 'app://todos' }, mode: 'js' }))).resolves.toEqual({});
    expect(openUrl).toHaveBeenCalledWith('app://todos');

    openUrl.mockResolvedValueOnce({ opened: false });
    await expect(drive(call('action', { action: { type: 'openUrl', url: 'other://x' }, mode: 'native' }))).rejects.toMatchObject({
      errorName: 'ACTION_NOT_SUPPORTED',
      message: expect.stringContaining('other://x'),
    });
    // pressBack stays a host action; the iOS DeviceProvider rejects it.
    await expect(call('action', { action: { type: 'pressBack' }, mode: 'native' })).resolves.toEqual({ hostInput: { kind: 'back' } });
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
    await expect(drive(call('action', { action: { type: 'setValue', matcher: { id: 'when' }, value: { date: d.toISOString() } }, mode: 'native', timeoutMs: 1000 }))).resolves.toEqual({});
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'set' }), d);
    // Only id / type / index matchers reach such components.
    await expect(drive(call('action', { action: { type: 'setValue', matcher: { id: 'when', text: 'x' }, value: 1 }, mode: 'js', timeoutMs: 300 }), 400)).rejects.toMatchObject({ errorName: 'ELEMENT_NOT_FOUND' });
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

  it('configure replaces the agent config at runtime (tracker switches, ignoreUrls)', async () => {
    const { rt, call } = setup();
    await call('configure', { config: { ...CONFIG, sync: { ...CONFIG.sync, trackers: { fake: false } as never, timeoutMs: 777 } } });
    expect(rt.config.sync.timeoutMs).toBe(777);
    expect(await call('getIdleState', {})).toEqual({ trackers: [] });
  });

  it('deviceInfo reports the window, pixel ratio and app state', async () => {
    const { call } = setup({ appState: () => 'background' });
    expect(await call('deviceInfo', {})).toEqual({ window: { width: 400, height: 800 }, pixelRatio: 3, appState: 'background' });
  });

  it('suspend uses @quiesco/native when it can, else reports false', async () => {
    const suspend = vi.fn(async () => true);
    expect(await setup({ native: native(undefined, suspend) }).call('suspend', {})).toEqual({ suspended: true });
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(await setup().call('suspend', {})).toEqual({ suspended: false });
  });
});
