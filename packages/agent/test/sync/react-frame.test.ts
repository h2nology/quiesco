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
