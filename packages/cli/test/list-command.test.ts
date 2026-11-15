import type { TestList } from '@quiesco/core';
import { describe, expect, it, vi } from 'vitest';

import { formatList, listCommand } from '../src/commands/list';
import { fakeContext } from './fake-context';

const list: TestList = {
  runner: 'cucumber',
  files: ['features/a.feature', 'features/b.feature'],
  tests: [
    { id: 'features/a.feature:3', file: 'features/a.feature', line: 3, name: 'adds', path: ['Todos', 'adds'] },
    { id: 'features/a.feature:9', file: 'features/a.feature', line: 9, name: 'edits', path: ['Todos', 'edits'] },
  ],
  errors: [{ file: 'features/b.feature', message: 'Parse error' }],
};

describe('quiesco list', () => {
  it('prints the tests grouped by file, the errors and a count', () => {
    expect(formatList(list)).toEqual(['features/a.feature', '  Todos › adds  :3', '  Todos › edits  :9', 'features/b.feature', '✗ features/b.feature: Parse error', '2 tests in 2 files']);
  });

  it('passes the runner and its arguments on, prints JSON with --json', async () => {
    const ctx = fakeContext();
    const listTests = vi.fn(async () => list);
    expect(await listCommand(['--runner', 'vitest', '--json', '--config', 'v.mts'], ctx, { listTests })).toBe(0);
    expect(listTests).toHaveBeenCalledWith({ runner: 'vitest', cwd: ctx.cwd, args: ['--config', 'v.mts'], env: ctx.env });
    expect(JSON.parse(ctx.lines.join('\n'))).toEqual(list);
  });

  it('fails when nothing could be listed, refuses an unknown runner', async () => {
    const ctx = fakeContext();
    expect(await listCommand([], ctx, { listTests: async () => ({ runner: 'jest', files: [], tests: [], errors: [{ message: 'not installed' }] }) })).toBe(1);
    expect(await listCommand(['--runner', 'mocha'], fakeContext())).toBe(2);
  });
});
