import { describe, expect, it, vi } from 'vitest';

import type { Lifecycle } from '@quiesco/core';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { addEvidence, fullName, handleEvent, jestWorker, tagLevelsOf } from '../src/events';
import { registryDir, sweepRegistry } from '../src/shared';
import type { TestLike } from '../src/events';

function testIn(name: string, ...describes: string[]): TestLike {
  let parent: TestLike['parent'] = { name: 'ROOT_DESCRIBE_BLOCK' };
  for (const d of describes) parent = { name: d, parent };
  return { name, parent, errors: [] };
}

function fakeLifecycle(opts: { runs?: boolean; files?: string[]; afterError?: Error } = {}) {
  return {
    running: true,
    runsHere: vi.fn(() => opts.runs ?? true),
    before: vi.fn(async () => undefined),
    after: vi.fn(async () => {
      if (opts.afterError !== undefined) throw opts.afterError;
      return { attachments: [], files: opts.files ?? [] };
    }),
  };
}

describe('tag levels and names', () => {
  it('reads title tags per describe level, outermost first, without the root block', () => {
    const t = testIn('renames a todo @android', 'todos @native', 'editing');
    expect(tagLevelsOf(t)).toEqual([['@native'], [], ['@android']]);
    expect(fullName(t)).toBe('todos @native > editing > renames a todo @android');
  });
});

describe('handleEvent', () => {
  it('skips a test tagged for another platform at test_start', async () => {
    const l = fakeLifecycle({ runs: false });
    const t = testIn('only ios @ios');
    await handleEvent(l as unknown as Lifecycle, { name: 'test_start', test: t });
    expect(t.mode).toBe('skip');
    expect(l.runsHere).toHaveBeenCalledWith([['@ios']]);
    expect(l.before).not.toHaveBeenCalled();
  });

  it('resets at test_started and ends the test at test_done', async () => {
    const l = fakeLifecycle();
    const t = testIn('adds a todo', 'todos @smoke');
    await handleEvent(l as unknown as Lifecycle, { name: 'test_start', test: t });
    expect(t.mode).toBeUndefined();
    await handleEvent(l as unknown as Lifecycle, { name: 'test_started', test: t });
    expect(l.before).toHaveBeenCalledWith([['@smoke'], []], 'todos @smoke > adds a todo');
    await handleEvent(l as unknown as Lifecycle, { name: 'test_done', test: t });
    expect(l.after).toHaveBeenCalledWith({ tags: ['@smoke'], failed: false });
    expect(t.errors).toEqual([]);
  });

  it('names the evidence files in a failed test\'s message', async () => {
    const l = fakeLifecycle({ files: ['/art/t/failure.png'] });
    const t = testIn('fails');
    const err = new Error('expected 1');
    t.errors.push([err, new Error('async')]);
    await handleEvent(l as unknown as Lifecycle, { name: 'test_done', test: t });
    expect(l.after).toHaveBeenCalledWith({ tags: [], failed: true });
    expect(err.message).toBe('expected 1\n\nQuiesco evidence:\n  /art/t/failure.png');
    expect(err.stack).toContain('Quiesco evidence:\n  /art/t/failure.png');
  });

  it('fails a passed test with the app error reported after it, and a failed reset', async () => {
    const late = new Error('late app error');
    const l = fakeLifecycle({ afterError: late });
    const t = testIn('passes');
    await handleEvent(l as unknown as Lifecycle, { name: 'test_done', test: t });
    expect(t.errors).toEqual([late]);
    const reset = new Error('reset failed');
    const l2 = { ...fakeLifecycle(), before: vi.fn(async () => Promise.reject(reset)) };
    const t2 = testIn('x');
    await handleEvent(l2 as unknown as Lifecycle, { name: 'test_started', test: t2 });
    expect(t2.errors).toEqual([reset]);
  });

  it('ignores other events and runs without a session', async () => {
    const l = fakeLifecycle();
    await handleEvent(l as unknown as Lifecycle, { name: 'run_start' });
    await handleEvent({ ...l, running: false } as unknown as Lifecycle, { name: 'test_start', test: testIn('a @ios') });
    expect(l.runsHere).not.toHaveBeenCalled();
  });
});

describe('addEvidence / jestWorker', () => {
  it('handles plain errors and nothing to add', () => {
    const t = testIn('t');
    const e = new Error('boom');
    t.errors.push(e);
    addEvidence(t, []);
    expect(e.message).toBe('boom');
    addEvidence(testIn('no errors'), ['/x']);
  });

  it('numbers worker processes from JEST_WORKER_ID; in band is worker 0 (Phase 6.12)', () => {
    expect(jestWorker(4, { JEST_WORKER_ID: '3' }, true)).toEqual({ index: 2, count: 4 });
    expect(jestWorker(2, { JEST_WORKER_ID: '1' }, false)).toEqual({ index: 0, count: 2 });
    expect(jestWorker(1, { JEST_WORKER_ID: '1' }, true)).toEqual({ index: 0, count: 1 });
    expect(jestWorker(undefined, {}, false)).toEqual({ index: 0, count: 1 });
  });
});

describe('worker registry (Phase 6.12)', () => {
  it('kills the registered children still alive and removes the registry', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-jest-test-'));
    const dir = registryDir(4242, tmp);
    expect(dir).toBe(path.join(tmp, 'quiesco-jest-4242'));
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '100.json'), JSON.stringify([11, 12]));
    fs.writeFileSync(path.join(dir, '101.json'), JSON.stringify([13, 'x']));
    fs.writeFileSync(path.join(dir, '102.json'), 'not json');
    const alive = new Set([11, 13]);
    const killed: number[] = [];
    const kill = (pid: number, signal?: NodeJS.Signals | 0) => {
      if (!alive.has(pid)) throw new Error('ESRCH');
      if (signal === 'SIGKILL') killed.push(pid);
    };
    expect(sweepRegistry(dir, kill)).toBe(2);
    expect(killed.sort()).toEqual([11, 13]);
    expect(fs.existsSync(dir)).toBe(false);
    expect(sweepRegistry(dir, kill)).toBe(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
