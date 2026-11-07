import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuiescoError } from '../src/errors';
import type { AppDeps } from '../src/platform';
import { AgentRuntime } from '../src/runtime';
import type { Clock, IdleTracker } from '../src/sync';
import { fakeScheduler, host, makeRoot, renderWith, text } from './helpers/fake-fiber';
import { CONFIG, FakeSocket, acceptHello } from './helpers/fake-socket';
import type { Spec } from './helpers/fake-fiber';

const clock: Clock = { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as number), now: () => Date.now() };
const R = (y: number) => ({ __rect: { x: 0, y, width: 100, height: 40 } });

function setup(opts: { busy?: () => boolean } = {}) {
  const target: Record<string, unknown> = {};
  const sockets: FakeSocket[] = [];
  const deps: AppDeps = {
    platform: () => 'android',
    dismissKeyboard: vi.fn(),
    nativeLaunchParams: () => ({ port: '7401', session: 'sess' }),
    hasNativeModule: () => false,
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    interactionManager: () => null,
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

  it('connects on mount with launch params and applies the config from hello', () => {
    const { rt, sockets } = setup();
    rt.mount(null);
    expect(sockets[0]?.url).toBe('ws://localhost:7401');
    acceptHello(sockets[0]!, { ...CONFIG, sync: { ...CONFIG.sync, timeoutMs: 1234 } });
    expect(rt.config.sync.timeoutMs).toBe(1234);
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

  it('native mode is not available yet; device actions are delegated to the host', async () => {
    const { call, deps } = setup();
    await expect(call('action', { action: { type: 'tap', matcher: { id: 'x' } }, mode: 'native' })).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
    await expect(call('action', { action: { type: 'pressBack' }, mode: 'js' })).resolves.toEqual({ hostInput: { kind: 'back' } });
    await expect(call('action', { action: { type: 'openUrl', url: 'app://x' }, mode: 'js' })).resolves.toEqual({ hostInput: { kind: 'navigate', url: 'app://x' } });
    await expect(drive(call('action', { action: { type: 'dismissKeyboard' }, mode: 'js' }))).resolves.toEqual({});
    expect(deps.dismissKeyboard).toHaveBeenCalledOnce();
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

  it('propagates SYNC_TIMEOUT unless sync is disabled for the call', async () => {
    const { target, call } = setup({ busy: () => true });
    sameRoot(target)(host('RCTView', { testID: 'a', ...R(0) }));
    const p = call('query', { matcher: { id: 'a' }, timeoutMs: 200 });
    const a = expect(p).rejects.toMatchObject({ errorName: 'SYNC_TIMEOUT', message: expect.stringContaining('fake busy') });
    await vi.advanceTimersByTimeAsync(300);
    await a;
    await expect(drive(call('query', { matcher: { id: 'a' }, sync: false }))).resolves.toMatchObject({ elements: [{ testID: 'a' }] });
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
});
