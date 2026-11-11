import { afterEach, describe, expect, it } from 'vitest';

import { addEvidence, fullName, quiesco, tagLevelsOf, vitestParallel } from '../src/index';

describe('tagLevelsOf', () => {
  it('groups title tags and own { tags } by level, outermost first', () => {
    const outer = { name: 'todos @native', tags: ['@smoke'] };
    const inner = { name: 'editing', tags: ['@smoke', '@slow'], suite: outer };
    const test = { name: 'renames a todo @android', tags: ['@smoke', '@slow', '@web'], suite: inner };
    expect(tagLevelsOf(test)).toEqual([['@native', '@smoke'], ['@slow'], ['@android', '@web']]);
    expect(fullName(test)).toBe('todos @native > editing > renames a todo @android');
  });

  it('handles a top-level test without tags', () => {
    expect(tagLevelsOf({ name: 'plain' })).toEqual([[]]);
  });
});

describe('addEvidence', () => {
  it('adds the evidence files to the first error message and stack', () => {
    const task = { name: 't', result: { state: 'fail', errors: [{ message: 'boom', stack: 'Error: boom\n    at x' }] } };
    addEvidence(task, ['/a/failure.png', '/a/element-tree.json']);
    expect(task.result.errors[0]?.message).toBe('boom\n\nQuiesco evidence:\n  /a/failure.png\n  /a/element-tree.json');
    expect(task.result.errors[0]?.stack).toContain('Error: boom\n\nQuiesco evidence:\n  /a/failure.png');
  });

  it('leaves a task without errors or files alone', () => {
    const task = { name: 't', result: { state: 'fail', errors: [{ message: 'boom' }] } };
    addEvidence(task, []);
    expect(task.result.errors[0]?.message).toBe('boom');
    expect(() => addEvidence({ name: 't' }, ['/x'])).not.toThrow();
  });
});

describe('quiesco()', () => {
  it('runs files one at a time in one worker and declares the platform tags', () => {
    const c = quiesco({ tags: { web: '@browser' }, extraTags: ['@smoke'] });
    expect(c).toMatchObject({ pool: 'forks', isolate: false, fileParallelism: false, testTimeout: 300_000 });
    expect(c.tags.map((t) => t.name)).toEqual(['@ios', '@android', '@browser', '@native', '@hard-reset', '@smoke']);
  });
});

describe('vitestParallel', () => {
  const g = globalThis as { __vitest_worker__?: { config?: { maxWorkers?: number } } };
  const saved = g.__vitest_worker__;
  afterEach(() => {
    g.__vitest_worker__ = saved;
  });

  it('refuses more than one worker, and does not check without the worker config', () => {
    g.__vitest_worker__ = { config: { maxWorkers: 4 } };
    expect(vitestParallel()).toMatch(/one at a time \(maxWorkers is 4\)/);
    g.__vitest_worker__ = { config: { maxWorkers: 1 } };
    expect(vitestParallel()).toBeNull();
    g.__vitest_worker__ = {};
    expect(vitestParallel()).toBeNull();
  });
});
