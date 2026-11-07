import { describe, expect, it, vi } from 'vitest';

import { IdleCallbackTracker } from '../../src/sync';
import type { InteractionManagerLike } from '../../src/sync';

function fakeRic() {
  const queue = new Map<number, () => void>();
  let next = 1;
  return {
    target: {
      requestIdleCallback: (cb: unknown) => {
        const id = next++;
        queue.set(id, cb as () => void);
        return id;
      },
      cancelIdleCallback: (id: unknown) => void queue.delete(id as number),
    },
    runAll: () => {
      for (const [id, cb] of [...queue]) {
        queue.delete(id);
        cb();
      }
    },
  };
}

describe('IdleCallbackTracker', () => {
  it('tracks requestIdleCallback until it runs or is cancelled', () => {
    const ric = fakeRic();
    const t = new IdleCallbackTracker({ target: ric.target, now: () => 0 });
    t.install();
    ric.target.requestIdleCallback(function warmCache() {});
    const id = ric.target.requestIdleCallback(() => {});
    expect(t.describeBusy()).toEqual(['requestIdleCallback(warmCache) 0ms', 'requestIdleCallback(anonymous) 0ms']);
    ric.target.cancelIdleCallback(id);
    ric.runAll();
    expect(t.isIdle()).toBe(true);
  });

  it('is a no-op without requestIdleCallback', () => {
    const t = new IdleCallbackTracker({ target: {} });
    t.install();
    expect(t.isIdle()).toBe(true);
  });

  it('tracks legacy InteractionManager handles and runAfterInteractions tasks', async () => {
    let resolveTask!: () => void;
    const im: InteractionManagerLike = {
      createInteractionHandle: vi.fn(() => 42),
      clearInteractionHandle: vi.fn(),
      runAfterInteractions: vi.fn(() => {
        const p = new Promise<void>((r) => (resolveTask = r));
        return { then: p.then.bind(p), cancel: vi.fn() };
      }),
    };
    const t = new IdleCallbackTracker({ target: {}, interactionManager: im, now: () => 0 });
    t.install();
    const h = im.createInteractionHandle();
    const task = im.runAfterInteractions(() => {});
    expect(t.describeBusy()).toEqual(['InteractionManager: 1 open interaction handle(s)', 'InteractionManager.runAfterInteractions task 0ms']);
    im.clearInteractionHandle(h);
    resolveTask();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.isIdle()).toBe(true);

    im.runAfterInteractions(() => {});
    expect(t.isIdle()).toBe(false);
    (task as { cancel: () => void }).cancel(); // cancelling an already finished task is harmless
    const second = im.runAfterInteractions(() => {}) as { cancel: () => void };
    second.cancel();
    expect(t.describeBusy()).toHaveLength(1); // the un-cancelled one
  });
});
