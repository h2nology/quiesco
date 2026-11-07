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
    const t = new FrameStableTracker({ hash: () => String(hashes++), ...f });
    expect(t.isIdle()).toBe(true);
    expect(f.pending()).toBe(0);
  });

  it('needs N consecutive frames with the same hash', () => {
    const f = frames();
    let h = 'a';
    const t = new FrameStableTracker({ hash: () => h, frames: 2, ...f });
    t.beginWait();
    expect(t.describeBusy()).toEqual(['no frame rendered yet (is the app in the foreground?)']);
    f.tick(); // a (1/2)
    expect(t.isIdle()).toBe(false);
    h = 'b';
    f.tick(); // b (1/2)
    expect(t.describeBusy()).toEqual(['element tree changing: stable for 1/2 frames']);
    f.tick(); // b (2/2)
    expect(t.isIdle()).toBe(true);
    t.endWait();
    expect(f.pending()).toBe(0);
  });

  it('restarts counting on each new wait and nests waits', () => {
    const f = frames();
    const t = new FrameStableTracker({ hash: () => 'same', frames: 2, ...f });
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
});
