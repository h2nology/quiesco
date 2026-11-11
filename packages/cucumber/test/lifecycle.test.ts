import { describe, expect, it, vi } from 'vitest';

import type { QuiescoConfig, Session, SessionOptions } from '@quiesco/core';

import { Lifecycle, tagLevels } from '../src/lifecycle';

function fakeSession(opts: { lateError?: Error } = {}) {
  const calls: unknown[] = [];
  let late = opts.lateError ?? null;
  const session = {
    startScenario: vi.fn(async (info: unknown) => void calls.push(['startScenario', info])),
    beforeScenario: vi.fn(async (info: unknown) => void calls.push(['beforeScenario', info])),
    afterScenario: vi.fn(async (r: { failed: boolean }) => {
      calls.push(['afterScenario', r]);
      return {
        files: [],
        attachments: r.failed
          ? [
              { data: Buffer.from('png'), mediaType: 'image/png', fileName: 'failure.png' },
              { data: '{"elementTree":{}}', mediaType: 'application/json', fileName: 'element-tree.json' },
            ]
          : [],
      };
    }),
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
  it('creates the session with config and platform', async () => {
    const { session } = fakeSession();
    const create = vi.fn<(o: SessionOptions) => Promise<Session>>(async () => session);
    const l = new Lifecycle({ config, createSession: create, env: { QUIESCO_PLATFORM: 'android' } });
    await l.beforeAll();
    expect(create).toHaveBeenCalledWith({ config, platform: 'android' });
    expect(l.current).toBe(session);
  });

  it('refuses cucumber-js --parallel before touching any device', async () => {
    const create = vi.fn<(o: SessionOptions) => Promise<Session>>();
    const l = new Lifecycle({ config, createSession: create, env: { QUIESCO_PLATFORM: 'android', CUCUMBER_PARALLEL: 'true', CUCUMBER_TOTAL_WORKERS: '2', CUCUMBER_WORKER_ID: '0' } });
    await expect(l.beforeAll()).rejects.toThrow(/does not support cucumber-js --parallel/);
    expect(create).not.toHaveBeenCalled();
  });

  it('skips scenarios tagged for other platforms and resets before the others', async () => {
    const { session, calls } = fakeSession();
    const l = new Lifecycle({ config: { ...config, tags: { web: '@browser' } }, platform: 'android', createSession: async () => session });
    await l.beforeAll();
    expect(await l.before(['@browser'])).toBe('skipped');
    expect(await l.before(['@ios'])).toBe('skipped');
    expect(await l.before(['@native', '@hard-reset'])).toBeUndefined();
    expect(calls).toEqual([
      ['startScenario', { name: 'scenario' }],
      ['beforeScenario', { tags: ['@native', '@hard-reset'], name: 'scenario' }],
    ]);
  });

  it('lets the innermost platform tag decide and passes the flat tags on', async () => {
    const { session, calls } = fakeSession();
    const l = new Lifecycle({ config, platform: 'android', createSession: async () => session });
    await l.beforeAll();
    expect(await l.before([['@native'], [], ['@ios'], []])).toBe('skipped');
    expect(await l.before([['@web'], [], ['@android', '@hard-reset'], []], '保存待办')).toBeUndefined();
    expect(calls).toEqual([
      ['startScenario', { name: '保存待办' }],
      ['beforeScenario', { tags: ['@web', '@android', '@hard-reset'], name: '保存待办' }],
    ]);
  });

  it('groups pickle tags by Gherkin level', () => {
    const tag = (id: string) => ({ id });
    const doc = {
      feature: {
        tags: [tag('f')],
        children: [
          { scenario: { tags: [tag('s1')], examples: [] } },
          { rule: { tags: [tag('r')], children: [{ scenario: { tags: [tag('s2')], examples: [{ tags: [tag('e')] }] } }] } },
        ],
      },
    };
    const pt = (name: string, astNodeId: string) => ({ name, astNodeId });
    expect(tagLevels([pt('@native', 'f'), pt('@android', 's1')], doc)).toEqual([['@native'], [], ['@android'], []]);
    expect(tagLevels([pt('@native', 'f'), pt('@web', 'r'), pt('@ios', 's2'), pt('@android', 'e')], doc)).toEqual([['@native'], ['@web'], ['@ios'], ['@android']]);
    // unknown nodes count as scenario tags; no feature → everything scenario-level.
    expect(tagLevels([pt('@x', '?')], doc)).toEqual([[], [], ['@x'], []]);
    expect(tagLevels([pt('@x', 'f')], {})).toEqual([[], [], ['@x'], []]);
  });

  it('ends the scenario through the session and returns its attachments', async () => {
    const { session, calls } = fakeSession();
    const l = new Lifecycle({ config, platform: 'android', createSession: async () => session });
    await l.beforeAll();
    await l.before([], 'a');
    const a = await l.after({ tags: [], failed: true });
    expect(a.attachments.map((x) => x.fileName)).toEqual(['failure.png', 'element-tree.json']);
    await l.before([], 'b');
    expect((await l.after({ tags: [], failed: false })).attachments).toEqual([]);
    // A skipped scenario has no artifacts to end.
    expect(await l.after({ tags: [], failed: false })).toEqual({ attachments: [], files: [] });
    expect(calls.filter((c) => Array.isArray(c) && c[0] === 'afterScenario')).toEqual([
      ['afterScenario', { failed: true }],
      ['afterScenario', { failed: false }],
    ]);
  });

  it('fails a passed scenario when the app reported an error after the last step', async () => {
    const { session } = fakeSession({ lateError: new Error('late app error') });
    const l = new Lifecycle({ config, platform: 'android', createSession: async () => session });
    await l.beforeAll();
    await l.before([], 'late');
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

describe('titleTags (core)', () => {
  it('reads @tags from a test or suite title', async () => {
    const { titleTags } = await import('@quiesco/core');
    expect(titleTags('adds a todo @ios @smoke')).toEqual(['@ios', '@smoke']);
    expect(titleTags('@android only')).toEqual(['@android']);
    expect(titleTags('mail a@example.com and @web')).toEqual(['@web']);
    expect(titleTags('no tags')).toEqual([]);
  });
});
