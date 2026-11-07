import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimerTracker } from '../../src/sync';
import type { TimerGlobals } from '../../src/sync';

type Target = Required<TimerGlobals>;

function setup(opts: { thresholdMs?: number; countIntervals?: boolean } = {}) {
  const target: Target = {
    setTimeout: ((cb: () => void, ms?: number, ...args: unknown[]) => setTimeout(cb, ms, ...args)) as Target['setTimeout'],
    clearTimeout: ((id: unknown) => clearTimeout(id as number)) as Target['clearTimeout'],
    setInterval: ((cb: () => void, ms?: number) => setInterval(cb, ms)) as Target['setInterval'],
    clearInterval: ((id: unknown) => clearInterval(id as number)) as Target['clearInterval'],
  };
  const t = new TimerTracker({ target, now: () => Date.now(), ...opts });
  t.install();
  return { t, target };
}

describe('TimerTracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('tracks setTimeout ≤ threshold until it fires', () => {
    const { t, target } = setup();
    const cb = vi.fn();
    target.setTimeout(function minPress() { cb(); }, 130);
    target.setTimeout(() => {}, 1500); // = threshold: counted
    target.setTimeout(() => {}, 1501); // > threshold: ignored
    vi.advanceTimersByTime(30);
    expect(t.describeBusy()).toEqual(['setTimeout(minPress, 130ms), fires in 100ms', 'setTimeout(anonymous, 1500ms), fires in 1470ms']);
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledOnce();
    expect(t.describeBusy()).toHaveLength(1);
    vi.advanceTimersByTime(1400);
    expect(t.isIdle()).toBe(true);
  });

  it('forgets cleared timeouts and passes arguments through', () => {
    const { t, target } = setup();
    const id = target.setTimeout(() => {}, 10);
    target.clearTimeout(id);
    expect(t.isIdle()).toBe(true);
    const cb = vi.fn();
    target.setTimeout(cb, 0, 'a', 1);
    vi.runAllTimers();
    expect(cb).toHaveBeenCalledWith('a', 1);
  });

  it('respects a custom threshold', () => {
    const { t, target } = setup({ thresholdMs: 100 });
    target.setTimeout(() => {}, 500);
    expect(t.isIdle()).toBe(true);
  });

  it('ignores setInterval by default and counts it with countIntervals until cleared', () => {
    const a = setup();
    a.target.setInterval(() => {}, 100);
    expect(a.t.isIdle()).toBe(true);
    a.t.uninstall();

    const b = setup({ countIntervals: true });
    const id = b.target.setInterval(function poll() {}, 100);
    vi.advanceTimersByTime(250);
    expect(b.t.describeBusy()).toEqual(['setInterval(poll, 100ms)']);
    b.target.clearInterval(id);
    expect(b.t.isIdle()).toBe(true);
  });

  it('restores the original functions on uninstall', () => {
    const target: TimerGlobals = { setTimeout: vi.fn() as unknown as Target['setTimeout'], clearTimeout: vi.fn() as unknown as Target['clearTimeout'] };
    const original = target.setTimeout;
    const t = new TimerTracker({ target });
    t.install();
    expect(target.setTimeout).not.toBe(original);
    t.uninstall();
    expect(target.setTimeout).toBe(original);
  });
});
