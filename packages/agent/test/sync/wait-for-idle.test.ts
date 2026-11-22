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
    await expect(p).resolves.toEqual({ waitedMs: 0, end: { endedAt: 0, checks: ['+0ms idle', '+0ms idle (confirmed)'] } });
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

  it('says what the busy trackers were busy with at the last busy check (#93)', async () => {
    let netIdleAt = 30;
    const engine = new SyncEngine([tracker('timer', () => Date.now() >= 10, () => ['setTimeout 10ms']), tracker('network', () => Date.now() >= netIdleAt, () => [`GET /items ${Date.now()}ms`])], clock);
    const p = engine.waitForIdle({ pollIntervalMs: 5 });
    await vi.advanceTimersByTimeAsync(100);
    // The reasons are read again when the busy trackers change (timer done at 10 ms), not on every check.
    await expect(p).resolves.toMatchObject({ waitedMs: expect.any(Number), busy: ['network: GET /items 10ms'] });
    netIdleAt = 0;
    const idle = engine.waitForIdle();
    await vi.advanceTimersByTimeAsync(0);
    await expect(idle).resolves.not.toHaveProperty('busy');
  });

  it('records how it ended: the last checks with the busy trackers, and what the trackers saw during it (#107)', async () => {
    const seq = [false, false, true, false, false, true, true];
    const react = tracker('react', () => seq.shift() ?? true);
    const native = tracker('native-module', () => true);
    native.describeActivity = (from, to) => [`call ${from}→${to}`];
    const engine = new SyncEngine([react, native], clock);
    const p = engine.waitForIdle({ pollIntervalMs: 10 });
    await vi.advanceTimersByTimeAsync(100);
    const r = await p;
    // idle at +20ms, but busy again in the confirming check (+21ms, an idle blip): the wait goes on.
    // (Fake timers run a 0 ms timeout 1 ms later.)
    expect(r.end).toEqual({
      endedAt: 42,
      checks: ['+21ms busy: react', '+31ms busy: react', '+41ms idle', '+42ms idle (confirmed)'],
      activity: ['native-module: call 0→42'],
    });
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
      expect(err.message).toMatch(/^App did not become idle within the 1000ms timeout\. Busy:/);
      expect(err.message).toContain('network: GET https://api.test/todos (1200ms)');
      expect(err.message).toContain('timer: setTimeout(anonymous, 1000ms), fires in 400ms');
      return true;
    });
    await vi.advanceTimersByTimeAsync(1100);
    await assertion;
  });

  it('a timeout also lists the trackers busy shortly before it, and says how the wait ended (#110)', async () => {
    let n = 0;
    const ends: (boolean | undefined)[] = [];
    const frame: IdleTracker = {
      ...tracker('frame-stable', () => Date.now() >= 980, () => [`element tree changing ${n++}`]),
      endWait: (timedOut) => void ends.push(timedOut),
    };
    const engine = new SyncEngine(
      [
        tracker('network', () => Date.now() >= 200 || Date.now() < 0, () => ['GET https://api.test/a (100ms)']),
        tracker('timer', () => false, () => ['setTimeout(anonymous, 50ms), fires in 0ms']),
        frame,
      ],
      clock,
    );
    const p = engine.waitForIdle({ timeoutMs: 1500 });
    const assertion = expect(p).rejects.toSatisfy((e: unknown) => {
      const err = e as QuiescoError<'SYNC_TIMEOUT'>;
      // network went idle 1300 ms before the timeout: not listed.
      expect(err.data.busy.map((b) => [b.name, b.idle])).toEqual([
        ['timer', false],
        ['frame-stable', true],
      ]);
      const frameState = err.data.busy[1]!;
      expect(frameState.idleForMs).toBeGreaterThan(500);
      expect(frameState.busy[0]).toMatch(/^element tree changing \d+$/);
      expect(err.message).toContain('  - timer: setTimeout(anonymous, 50ms), fires in 0ms');
      expect(err.message).toMatch(/ {2}- frame-stable \(idle at the timeout, busy \d+ms before it\): element tree changing \d+/);
      expect(err.data.syncEnd?.checks).toHaveLength(4);
      expect(err.data.syncEnd?.checks.at(-1)).toMatch(/^\+15\d\dms busy: timer$/);
      return true;
    });
    await vi.advanceTimersByTimeAsync(1600);
    await assertion;
    expect(ends).toEqual([true]);
  });

  it('reports the whole call timeout when waiting with what is left of it', async () => {
    const engine = new SyncEngine([tracker('timer', () => false, () => ['setTimeout(t, 500ms)'])], clock);
    const p = engine.waitForIdle({ timeoutMs: 300, reportedTimeoutMs: 10_000 });
    const a = expect(p).rejects.toThrow(/within the 10000ms timeout \(waited 30\dms for idle after the action\)/);
    await vi.advanceTimersByTimeAsync(400);
    await a;
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
    a.describeLastWait = () => ['changing at the end of the last wait'];
    b.describeLastWait = () => ['not listed while busy'];
    expect(engine.getIdleState()).toEqual([
      { name: 'a', idle: true, busy: [], lastWait: ['changing at the end of the last wait'] },
      { name: 'b', idle: false, busy: ['why'] },
    ]);
    engine.uninstall();
    engine.uninstall();
    expect(a.calls).toEqual(['install', 'uninstall']);
  });
});

describe('SyncEngine.setSkipped (Phase 6.5: background)', () => {
  it('treats skipped trackers as idle and leaves them out of getIdleState, re-evaluated on every check', async () => {
    const busy: IdleTracker = { name: 'frame-stable', isIdle: () => false, describeBusy: () => ['no frame'], install() {}, uninstall() {} };
    const ok: IdleTracker = { name: 'network', isIdle: () => true, describeBusy: () => [], install() {}, uninstall() {} };
    const engine = new SyncEngine([busy, ok], { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as number), now: () => Date.now() });
    let background = true;
    engine.setSkipped(() => (background ? new Set(['frame-stable']) : new Set()));
    expect(engine.getIdleState().map((s) => s.name)).toEqual(['network']);
    await expect(engine.waitForIdle({ timeoutMs: 200 })).resolves.toMatchObject({});
    background = false;
    await expect(engine.waitForIdle({ timeoutMs: 50 })).rejects.toMatchObject({ errorName: 'SYNC_TIMEOUT' });
  });
});

describe('SyncEngine.setBackground (6.7 batch C: Android pauses JS timers behind another activity)', () => {
  // Timers that never fire, as on Android while a permission dialog's activity is on top.
  const pausedClock = { setTimeout: () => 0, clearTimeout: () => undefined, now: () => Date.now() };
  const tracker = (name: string, idle: () => boolean): IdleTracker => ({ name, isIdle: idle, describeBusy: () => ['busy'], install() {}, uninstall() {} });

  it('returns in the background once every active tracker is idle, without a timer-based second check', async () => {
    const engine = new SyncEngine([tracker('network', () => true)], pausedClock);
    engine.setBackground(() => true);
    await expect(engine.waitForIdle({ timeoutMs: 1000 })).resolves.toMatchObject({});
  });

  it('is woken by an AppState change while its timer is paused, and unsubscribes afterwards', async () => {
    let background = false;
    let listener: (() => void) | null = null;
    const unsubscribe = vi.fn(() => {
      listener = null;
    });
    const engine = new SyncEngine([tracker('frame-stable', () => false), tracker('network', () => true)], pausedClock);
    engine.setSkipped(() => (background ? new Set(['frame-stable']) : new Set()));
    engine.setBackground(
      () => background,
      (wake) => {
        listener = wake;
        return unsubscribe;
      },
    );
    let done = false;
    const wait = engine.waitForIdle({ timeoutMs: 1000 }).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false); // frame-stable busy, sleeping on a timer that never fires
    background = true;
    (listener as (() => void) | null)?.();
    await wait;
    expect(done).toBe(true);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('a tracker still busy when the app went to the background: the next wake() (a host message) finds it idle (#66)', async () => {
    let busy = true;
    const engine = new SyncEngine([tracker('react', () => !busy)], pausedClock);
    engine.setBackground(() => true, () => () => undefined);
    let done = false;
    const wait = engine.waitForIdle({ timeoutMs: 10_000 }).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false); // react busy, sleeping on a timer that never fires
    engine.wake(); // a host tick while still busy: checks again and sleeps again
    await Promise.resolve();
    expect(done).toBe(false);
    busy = false;
    engine.wake();
    await wait;
    expect(done).toBe(true);
  });

  it('a tracker that never settles in the background: a wake() after the timeout reports SYNC_TIMEOUT (#66)', async () => {
    vi.useFakeTimers({ now: 0 });
    try {
      const engine = new SyncEngine([tracker('react', () => false)], pausedClock);
      engine.setBackground(() => true, () => () => undefined);
      const wait = engine.waitForIdle({ timeoutMs: 1000 });
      wait.catch(() => undefined);
      vi.setSystemTime(1500);
      engine.wake();
      await expect(wait).rejects.toMatchObject({ errorName: 'SYNC_TIMEOUT' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('wake() with nothing waiting does nothing; a finished wait is not woken again', async () => {
    const engine = new SyncEngine([tracker('network', () => true)], pausedClock);
    engine.setBackground(() => true);
    engine.wake();
    await engine.waitForIdle({ timeoutMs: 1000 });
    expect(() => engine.wake()).not.toThrow();
  });

  it('keeps the two-macrotask confirmation in the foreground', async () => {
    const engine = new SyncEngine([tracker('network', () => true)], pausedClock);
    engine.setBackground(() => false, () => () => undefined);
    let done = false;
    void engine.waitForIdle({ timeoutMs: 1000 }).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false); // waits for the confirmation timer
  });
});
