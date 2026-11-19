import path from 'node:path';

import { listTests } from '@quiesco/core';
import { describe, expect, it } from 'vitest';

import { isHookCall, parseListArgs } from '../src/list';

const cwd = path.resolve(__dirname, 'fixtures/events-project');

describe('vitest list', () => {
  it('lists the tests statically with Vitest’s ids, files and lines (test.each once)', async () => {
    const list = await listTests({ runner: 'vitest', cwd });
    expect(list.errors).toEqual([]);
    expect(list.files).toEqual(['tests/a.e2e.mjs', 'tests/b.e2e.mjs']);
    expect(list.tests.map((t) => t.path.join(' > '))).toEqual(['outer > inner > passes', 'outer > fails', 'outer > skipped', 'outer > todo', 'outer > each %i', 'top level']);
    expect(list.tests[0]).toMatchObject({ file: 'tests/a.e2e.mjs', line: 5, name: 'passes', id: expect.stringMatching(/^\d+_0_0_0$/) });
  });

  it('filters by file', async () => {
    const list = await listTests({ runner: 'vitest', cwd, args: ['b.e2e'] });
    expect(list.tests.map((t) => t.name)).toEqual(['top level']);
  });

  it('does not list hook calls through the test function as tests (#55)', async () => {
    const list = await listTests({ runner: 'vitest', cwd: path.resolve(__dirname, 'fixtures/list-hooks') });
    expect(list.errors).toEqual([]);
    expect(list.tests.map((t) => `${t.file}:${t.line} ${t.path.join(' > ')}`)).toEqual(['tests/hooks.e2e.mjs:10 logs in', 'tests/hooks.e2e.mjs:15 list > shows items', 'tests/typed.e2e.ts:9 typed test']);
  });

  it('tells hook calls from tests by their source', () => {
    const lines = ['test.beforeEach(reset);', '  it.afterAll (() => {});', "test.each([1])('n %i', () => {});", "test.skip('x', () => {});", "  test('beforeEach', () => {});"];
    expect(lines.map((_, i) => isHookCall(lines, { line: i + 1, column: i === 1 || i === 4 ? 3 : 1 }))).toEqual([true, true, false, false, false]);
    expect(isHookCall(null, { line: 1, column: 1 })).toBe(false);
    expect(isHookCall(lines, undefined)).toBe(false);
  });

  it('parses its arguments', () => {
    expect(parseListArgs(['--out', 'o.json', '--config=v.mts', 'e2e/a'])).toEqual({ out: 'o.json', config: 'v.mts', filters: ['e2e/a'] });
  });
});
