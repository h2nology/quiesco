import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuiescoError } from '../../src/errors';
import { SyncEngine } from '../../src/sync';
import type { Clock, IdleTracker } from '../../src/sync';

const clock: Clock = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id as number),
  now: () => Date.now(),
};

function tracker(name: string, idle: () => boolean, busy: () => string[] = () => ['busy']): IdleTracker & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    isIdle: idle,
    describeBusy: busy,
    install: () => calls.push('install'),
    uninstall: () => calls.push('uninstall'),
    beginWait: () => calls.push('begin'),
    endWait: () => calls.push('end'),
  };
}

describe('SyncEngine.waitForIdle', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  it('resolves after two idle checks in different macrotasks', async () => {
    const checks: number[] = [];
    const t = tracker('a', () => {
      checks.push(Date.now());
      return true;
    });
    const engine = new SyncEngine([t], clock);
    const p = engine.waitForIdle();
    expect(checks).toHaveLength(1); // first check is synchronous
    await vi.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toEqual({ waitedMs: 0 });
    expect(checks).toHaveLength(2);
    expect(t.calls).toEqual(['begin', 'end']);
  });

  it('does not resolve when the confirmation check finds work (idle blip)', async () => {
    // idle, busy (e.g. a promise callback queued more work), then idle for good after 50ms
    const seq = [true, false];
    const t = tracker('react', () => (seq.length > 0 ? (seq.shift() as boolean) : Date.now() >= 50));
    const engine = new SyncEngine([t], clock);
    let done = false;
    const p = engine.waitForIdle({ pollIntervalMs: 10 }).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(40);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(30);
    await expect(p).resolves.toMatchObject({ waitedMs: expect.any(Number) });
    expect((await p).waitedMs).toBeGreaterThanOrEqual(50);
  });

  it('waits for all trackers', async () => {
    let netIdle = false;
    const engine = new SyncEngine([tracker('timer', () => true), tracker('network', () => netIdle)], clock);
    let done = false;
    void engine.waitForIdle().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toBe(false);
    netIdle = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(done).toBe(true);
  });

  it('times out with SYNC_TIMEOUT listing every busy tracker', async () => {
    const engine = new SyncEngine(
      [
        tracker('network', () => false, () => ['GET https://api.test/todos (1200ms)']),
        tracker('timer', () => false, () => ['setTimeout(anonymous, 1000ms), fires in 400ms']),
        tracker('react', () => true),
      ],
      clock,
    );
    const p = engine.waitForIdle({ timeoutMs: 1000 });
    const assertion = expect(p).rejects.toSatisfy((e: unknown) => {
      const err = e as QuiescoError<'SYNC_TIMEOUT'>;
      expect(err).toBeInstanceOf(QuiescoError);
      expect(err.toJSON().code).toBe(1003);
      expect(err.data.busy.map((b) => b.name)).toEqual(['network', 'timer']);
      expect(err.message).toContain('network: GET https://api.test/todos (1200ms)');
      expect(err.message).toContain('timer: setTimeout(anonymous, 1000ms), fires in 400ms');
      return true;
    });
    await vi.advanceTimersByTimeAsync(1100);
    await assertion;
  });

  it('treats a throwing tracker as busy and still calls endWait', async () => {
    const t = tracker('broken', () => {
      throw new Error('x');
    });
    const engine = new SyncEngine([t], clock);
    const p = engine.waitForIdle({ timeoutMs: 50 });
    const assertion = expect(p).rejects.toThrow(/broken/);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(t.calls).toEqual(['begin', 'end']);
  });

  it('getIdleState() reports each tracker; install/uninstall are idempotent', () => {
    const a = tracker('a', () => true);
    const b = tracker('b', () => false, () => ['why']);
    const engine = new SyncEngine([a, b], clock);
    engine.install();
    engine.install();
    expect(engine.getIdleState()).toEqual([
      { name: 'a', idle: true, busy: [] },
      { name: 'b', idle: false, busy: ['why'] },
    ]);
    engine.uninstall();
    engine.uninstall();
    expect(a.calls).toEqual(['install', 'uninstall']);
  });
});
