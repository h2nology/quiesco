import path from 'node:path';

import { listTests } from '@quiesco/core';
import { describe, expect, it } from 'vitest';

import { parseListArgs } from '../src/list';

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

  it('parses its arguments', () => {
    expect(parseListArgs(['--out', 'o.json', '--config=v.mts', 'e2e/a'])).toEqual({ out: 'o.json', config: 'v.mts', filters: ['e2e/a'] });
  });
});
