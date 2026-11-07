import { describe, expect, it, vi } from 'vitest';

import type { QuiescoConfig, Session, SessionOptions } from '@quiesco/core';

import { Lifecycle } from '../src/lifecycle';

function fakeSession(opts: { lateError?: Error } = {}) {
  const calls: unknown[] = [];
  let late = opts.lateError ?? null;
  const session = {
    beforeScenario: vi.fn(async (info: unknown) => void calls.push(['beforeScenario', info])),
    collectEvidence: vi.fn(async () => ({ screenshot: Buffer.from('png'), tree: { type: 'RCTView', children: [] }, idle: [], errors: ['x: y'] })),
    dispose: vi.fn(async () => void calls.push('dispose')),
    driver: {
      takeAppError: () => {
        const e = late;
        late = null;
        return e;
      },
    },
  };
  return { session: session as unknown as Session, raw: session, calls };
}

const config: QuiescoConfig = { apps: { android: { package: 'p' } } };

describe('Lifecycle', () => {
  it('creates the session with config, platform and worker index', async () => {
    const { session } = fakeSession();
    const create = vi.fn<(o: SessionOptions) => Promise<Session>>(async () => session);
    const l = new Lifecycle({ config, createSession: create, env: { QUIESCO_PLATFORM: 'android', CUCUMBER_WORKER_ID: '2' } });
    await l.beforeAll();
    expect(create).toHaveBeenCalledWith({ config, platform: 'android', workerIndex: 2 });
    expect(l.current).toBe(session);
  });

  it('skips scenarios tagged for other platforms and resets before the others', async () => {
    const { session, calls } = fakeSession();
    const l = new Lifecycle({ config: { ...config, tags: { web: '@browser' } }, platform: 'android', createSession: async () => session });
    await l.beforeAll();
    expect(await l.before(['@browser'])).toBe('skipped');
    expect(await l.before(['@ios'])).toBe('skipped');
    expect(await l.before(['@native', '@hard-reset'])).toBeUndefined();
    expect(calls).toEqual([['beforeScenario', { tags: ['@native', '@hard-reset'] }]]);
  });

  it('returns evidence attachments for failed scenarios', async () => {
    const { session } = fakeSession();
    const l = new Lifecycle({ config, platform: 'android', createSession: async () => session });
    await l.beforeAll();
    const a = await l.after({ tags: [], failed: true });
    expect(a.map((x) => x.mediaType)).toEqual(['image/png', 'application/json', 'application/json', 'text/plain']);
    expect(String(a[1]?.data)).toContain('"elementTree"');
    expect(await l.after({ tags: [], failed: false })).toEqual([]);
  });

  it('fails a passed scenario when the app reported an error after the last step', async () => {
    const { session } = fakeSession({ lateError: new Error('late app error') });
    const l = new Lifecycle({ config, platform: 'android', createSession: async () => session });
    await l.beforeAll();
    await expect(l.after({ tags: [], failed: false })).rejects.toThrow('late app error');
  });

  it('disposes the session once', async () => {
    const { session, raw } = fakeSession();
    const l = new Lifecycle({ config, platform: 'android', createSession: async () => session });
    await l.beforeAll();
    await l.afterAll();
    await l.afterAll();
    expect(raw.dispose).toHaveBeenCalledOnce();
    expect(() => l.current).toThrow(/not running/);
  });

  it('requires a platform', async () => {
    const l = new Lifecycle({ config, env: {} });
    await expect(l.beforeAll()).rejects.toThrow(/QUIESCO_PLATFORM/);
  });
});
