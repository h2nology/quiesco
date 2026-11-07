import { describe, expect, it, vi } from 'vitest';

import { BackdoorRegistry } from '../src/backdoor';
import type { QuiescoError } from '../src/errors';
import { findNonJson } from '../src/json-check';
import { ResetManager } from '../src/reset';
import { defaultStorageAdapters } from '../src/reset/storage-defaults';
import { quiesco as stubApi } from '../src/stub';

describe('findNonJson', () => {
  it('accepts JSON and reports the first offending path', () => {
    expect(findNonJson({ a: [1, 'x', null, { b: true }] })).toBeNull();
    expect(findNonJson({ items: [{ createdAt: new Date(0) }] })).toEqual({ path: '$.items[0].createdAt', reason: 'Date instance (only plain objects and arrays)' });
    expect(findNonJson({ 'a-b': () => 1 })).toEqual({ path: '$["a-b"]', reason: 'function' });
    expect(findNonJson([Number.NaN])).toEqual({ path: '$[0]', reason: 'NaN' });
    expect(findNonJson({ u: undefined })).toEqual({ path: '$.u', reason: 'undefined' });
    expect(findNonJson(new Map())?.reason).toMatch(/^Map instance/);
    const cyc: Record<string, unknown> = {};
    cyc['self'] = cyc;
    expect(findNonJson(cyc)).toEqual({ path: '$.self', reason: 'circular reference' });
    expect(findNonJson(Object.create(null) as object)).toBeNull();
    const shared = { x: 1 };
    expect(findNonJson([shared, shared])).toBeNull(); // repeated, not circular
  });
});

describe('BackdoorRegistry', () => {
  it('calls the backdoor with the arguments and returns its (awaited) result', async () => {
    const r = new BackdoorRegistry();
    r.register('seedTodos', async (titles: string[]) => titles.length);
    await expect(r.call('seedTodos', [['a', 'b']])).resolves.toBe(2);
    r.register('noResult', () => undefined);
    await expect(r.call('noResult', [])).resolves.toBeNull();
  });

  it('lists registered names when the backdoor is missing', async () => {
    const r = new BackdoorRegistry();
    r.register('loginAs', () => null);
    const off = r.register('seedTodos', () => null);
    off();
    await expect(r.call('logout', [])).rejects.toSatisfy((e: unknown) => {
      const err = e as QuiescoError<'BACKDOOR_NOT_REGISTERED'>;
      expect(err.toJSON()).toMatchObject({ code: 1006, data: { name: 'logout', registered: ['loginAs'] } });
      expect(err.message).toBe('No backdoor named "logout". Registered: loginAs');
      return true;
    });
  });

  it('re-registering replaces; a stale unregister does not remove the new one', async () => {
    const r = new BackdoorRegistry();
    const off = r.register('x', () => 1);
    r.register('x', () => 2);
    off();
    await expect(r.call('x', [])).resolves.toBe(2);
  });

  it('wraps exceptions in BACKDOOR_FAILED and rejects non-JSON results', async () => {
    const r = new BackdoorRegistry();
    r.register('boom', () => {
      throw new Error('db down');
    });
    r.register('date', () => ({ at: new Date() }));
    await expect(r.call('boom', [])).rejects.toMatchObject({ errorName: 'BACKDOOR_FAILED', data: { name: 'boom', message: 'db down' } });
    await expect(r.call('date', [])).rejects.toMatchObject({ errorName: 'NOT_SERIALIZABLE', data: { where: 'result', path: '$result.at' } });
  });

  it('validates registration arguments', () => {
    const r = new BackdoorRegistry();
    expect(() => r.register('', () => 1)).toThrow(TypeError);
    expect(() => r.register('x', 1 as never)).toThrow(TypeError);
  });
});

describe('ResetManager', () => {
  it('clears storage, then runs hooks in order, then remounts', async () => {
    const order: string[] = [];
    const m = new ResetManager(() => [{ name: 'AsyncStorage', clear: async () => void order.push('async') }]);
    m.registerStorage({ name: 'mmkv', clear: () => void order.push('mmkv') });
    m.onReset(async () => void order.push('hook1'));
    const off = m.onReset(() => void order.push('removed'));
    m.onReset(() => void order.push('hook2'));
    off();
    await m.run(() => order.push('remount'));
    expect(order).toEqual(['async', 'mmkv', 'hook1', 'hook2', 'remount']);
  });

  it('fails with RESET_FAILED naming the step', async () => {
    const m = new ResetManager(() => []);
    m.registerStorage({ name: 'secure', clear: () => Promise.reject(new Error('locked')) });
    await expect(m.run(() => {})).rejects.toMatchObject({ errorName: 'RESET_FAILED', data: { step: 'storage:secure', message: 'locked' } });

    const m2 = new ResetManager(() => []);
    m2.onReset(() => {
      throw new Error('store busy');
    });
    await expect(m2.run(() => {})).rejects.toMatchObject({ data: { step: 'onReset#0' } });

    await expect(new ResetManager(() => []).run(null)).rejects.toMatchObject({ data: { step: 'remount', message: 'QuiescoRoot is not mounted' } });
  });
});

describe('web storage defaults', () => {
  it('clears localStorage, sessionStorage and every IndexedDB database', async () => {
    const local = { clear: vi.fn() };
    const session = { clear: vi.fn() };
    const deleted: string[] = [];
    const indexedDB = {
      databases: async () => [{ name: 'a' }, { name: 'b' }, {}],
      deleteDatabase(name: string) {
        const req = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, onblocked: null as (() => void) | null };
        queueMicrotask(() => {
          deleted.push(name);
          (name === 'b' ? req.onblocked : req.onsuccess)?.();
        });
        return req;
      },
    };
    const adapters = defaultStorageAdapters({ localStorage: local, sessionStorage: session, indexedDB });
    expect(adapters.map((a) => a.name)).toEqual(['localStorage', 'sessionStorage', 'indexedDB']);
    for (const a of adapters) await a.clear();
    expect(local.clear).toHaveBeenCalledOnce();
    expect(session.clear).toHaveBeenCalledOnce();
    expect(deleted).toEqual(['a', 'b']);
  });

  it('has nothing to clear outside a browser', () => {
    expect(defaultStorageAdapters({})).toEqual([]);
  });
});

describe('production stub API', () => {
  it('accepts registrations as no-ops', () => {
    expect(stubApi.backdoor('x', () => 1)()).toBeUndefined();
    expect(stubApi.onReset(() => {})()).toBeUndefined();
    expect(stubApi.registerStorage({ name: 'n', clear: () => {} })()).toBeUndefined();
  });
});
