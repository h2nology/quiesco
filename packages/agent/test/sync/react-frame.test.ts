import { describe, expect, it } from 'vitest';

import { FrameStableTracker, ReactTracker } from '../../src/sync';

describe('ReactTracker', () => {
  it('is idle only when both root fields (A) and scheduler (B) are idle', () => {
    const src = { a: [] as string[], b: [] as string[] };
    const t = new ReactTracker({ pendingRootWork: () => src.a, pendingSchedulerTasks: () => src.b });
    expect(t.isIdle()).toBe(true);
    src.a = ['pendingLanes=0b10'];
    expect(t.isIdle()).toBe(false);
    src.a = [];
    src.b = ['task#3 p3 12ms'];
    expect(t.isIdle()).toBe(false);
    src.a = ['callbackNode'];
    expect(t.describeBusy()).toEqual(['callbackNode', 'task#3 p3 12ms']);
  });
});

function frames() {
  const queue: (() => void)[] = [];
  return {
    requestFrame: (cb: () => void) => queue.push(cb),
    cancelFrame: () => void queue.splice(0),
    tick: () => queue.splice(0).forEach((cb) => cb()),
    pending: () => queue.length,
  };
}

describe('FrameStableTracker', () => {
  it('is idle outside waits and does not sample', () => {
    const f = frames();
    let hashes = 0;
    const t = new FrameStableTracker({ snapshot: () => [String(hashes++)], ...f });
    expect(t.isIdle()).toBe(true);
    expect(f.pending()).toBe(0);
  });

  it('needs N consecutive frames with the same hash', () => {
    const f = frames();
    let h = 'a';
    let clock = 1000;
    const t = new FrameStableTracker({ snapshot: () => ['View#root @0,0 100x100 children=1', `Text "${h}" @0,0 10x10 children=0`], frames: 2, now: () => clock, ...f });
    t.beginWait();
    expect(t.describeBusy()).toEqual(['no frame rendered yet (is the app in the foreground?)']);
    f.tick(); // a (1/2)
    expect(t.isIdle()).toBe(false);
    h = 'b';
    clock = 1250;
    f.tick(); // b (1/2)
    expect(t.describeBusy()).toEqual([
      'element tree changing: stable for 1/2 frames (2 frames sampled in 250ms)',
      'last change: first difference at node 1: Text "a" @0,0 10x10 children=0 → Text "b" @0,0 10x10 children=0',
      'recent changes (1 in 250ms): +250ms 2 nodes @1',
    ]);
    f.tick(); // b (2/2)
    expect(t.isIdle()).toBe(true);
    t.endWait();
    expect(f.pending()).toBe(0);
  });

  it('restarts counting on each new wait and nests waits', () => {
    const f = frames();
    const t = new FrameStableTracker({ snapshot: () => ['same'], frames: 2, ...f });
    t.beginWait();
    f.tick();
    f.tick();
    expect(t.isIdle()).toBe(true);
    t.endWait();
    t.beginWait();
    t.beginWait();
    expect(t.isIdle()).toBe(false);
    t.endWait();
    f.tick();
    f.tick();
    expect(t.isIdle()).toBe(true); // still sampling: one wait is open
    t.endWait();
    expect(f.pending()).toBe(0);
  });

  it('names added / removed nodes and clips long lines', async () => {
    const { describeChange } = await import('../../src/sync/frame-stable');
    expect(describeChange(['a', 'b'], ['a', 'b', 'c'])).toBe('node count 2 → 3; first difference at node 2: (none) → c');
    expect(describeChange(['a', 'x'], ['a'])).toBe('node count 2 → 1; first difference at node 1: x → (none)');
    const long = 'Text "' + 'z'.repeat(200) + '"';
    expect(describeChange(['a'], [long]).endsWith('…')).toBe(true);
  });

  it('names a node that keeps changing back and forth while other nodes change too, and keeps the reasons after a busy wait (#102)', () => {
    const f = frames();
    let clock = 0;
    let flipped = false;
    let rows = 1;
    const tree = () => [
      `RCTView @0,-9584 411x16744 children=${flipped ? 3 : 2}`,
      ...(flipped ? ['RCTView#edge-row @0,0 411x51 children=1'] : []),
      ...Array.from({ length: rows }, (_, i) => `RCTView#row-${i} @0,${51 + i * 51} 411x51 children=1`),
    ];
    const t = new FrameStableTracker({ snapshot: tree, frames: 2, now: () => clock, ...f });
    t.beginWait();
    f.tick();
    // The edge row flips, and between flips the list renders one more row at its end.
    for (let i = 1; i <= 7; i++) {
      clock += 100;
      if (i % 2 === 1) flipped = !flipped;
      else rows++;
      f.tick();
    }
    const busy = t.describeBusy();
    expect(busy[1]).toBe('last change: node count 6 → 5; first difference at node 0: RCTView @0,-9584 411x16744 children=3 → RCTView @0,-9584 411x16744 children=2');
    expect(busy[2]).toMatch(
      /^the same change went back and forth in 4 of the last 7 changes \(since \+100ms\): RCTView @0,-9584 411x16744 children=2 ↔ RCTView @0,-9584 411x16744 children=3, an element added and removed: .*getItemLayout/,
    );
    expect(busy[3]).toBe('recent changes (7 in 700ms): +200ms 3→4 nodes @3, +300ms 4→3 nodes @0, +400ms 3→4 nodes @3, +500ms 4→5 nodes @0, +600ms 5→6 nodes @5, +700ms 6→5 nodes @0');
    expect(t.describeLastWait()).toEqual([]);
    t.endWait();
    expect(t.isIdle()).toBe(true);
    expect(t.describeBusy()).toEqual([]);
    expect(t.describeLastWait()).toEqual(busy);
    t.beginWait();
    f.tick();
    f.tick();
    t.endWait();
    expect(t.describeLastWait()).toEqual([]);
  });

  it('keeps the history of a wait that timed out on a stable frame after changes (#110)', () => {
    const f = frames();
    const states = [['x'], ['y'], ['x'], ['y'], ['x'], ['x']];
    let i = 0;
    const t = new FrameStableTracker({ snapshot: () => states[Math.min(i++, states.length - 1)]!, frames: 2, ...f });
    t.beginWait();
    for (let k = 0; k < states.length; k++) f.tick(); // x y x y x x: stable for 2 frames at the end
    expect(t.isIdle()).toBe(true);
    t.endWait(true);
    const last = t.describeLastWait();
    expect(last[0]).toMatch(/^element tree changed 4 times, stable for 2\/2 frames when the wait ended \(6 frames sampled in \d+ms\)$/);
    expect(last.some((l) => l.startsWith('the same change went back and forth in 4 of the last 4 changes'))).toBe(true);
    // A wait that ends idle (not timed out) keeps nothing; neither does a timeout without any change.
    t.beginWait();
    i = 0;
    for (let k = 0; k < states.length; k++) f.tick();
    t.endWait();
    expect(t.describeLastWait()).toEqual([]);
    const still = new FrameStableTracker({ snapshot: () => ['x'], frames: 2, ...f });
    still.beginWait();
    f.tick();
    f.tick();
    still.endWait(true);
    expect(still.describeLastWait()).toEqual([]);
  });

  it('needs both ways twice; a same-size toggle gets the generic hint; a counter is not back and forth', () => {
    const f = frames();
    const states = [['x'], ['y'], ['x'], ['z'], ['x'], ['z'], ['x'], ['z']];
    let i = 0;
    const t = new FrameStableTracker({ snapshot: () => states[Math.min(i++, states.length - 1)]!, frames: 2, ...f });
    t.beginWait();
    for (let k = 0; k < 4; k++) f.tick(); // x y x z: x ↔ y once each way
    expect(t.describeBusy().some((l) => l.includes('back and forth'))).toBe(false);
    for (let k = 0; k < 4; k++) f.tick(); // then x→z, z→x, x→z, z→x, x→z
    expect(t.describeBusy()[2]).toMatch(/^the same change went back and forth in 5 of the last 7 changes \(since \+\d+ms\): x ↔ z: something toggles, e\.g\. a blinking cursor/);
    t.endWait();

    let n = 0;
    const counter = new FrameStableTracker({ snapshot: () => [`Text "Loading ${n++}%"`], frames: 2, ...f });
    counter.beginWait();
    for (let k = 0; k < 10; k++) f.tick();
    expect(counter.describeBusy().some((l) => l.includes('back and forth'))).toBe(false);
    counter.endWait();
  });

  it('reports a starved UI thread through the sampled frame count', () => {
    const f = frames();
    let n = 0;
    let clock = 0;
    const t = new FrameStableTracker({ snapshot: () => [String(n++)], frames: 2, now: () => clock, ...f });
    t.beginWait();
    clock = 9000;
    f.tick();
    f.tick();
    expect(t.describeBusy()[0]).toBe('element tree changing: stable for 1/2 frames (2 frames sampled in 9000ms)');
    t.endWait();
  });
});
