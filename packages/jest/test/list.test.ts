import path from 'node:path';

import { listTests } from '@quiesco/core';
import { describe, expect, it } from 'vitest';

import { collectOnlyArgs, listArgs } from '../src/list';
import { jestTestId } from '../src/reporter';

const cwd = path.resolve(__dirname, 'fixtures/events-project');

describe('jest list', () => {
  it('collects the tests without running them: ids as the reporter sends them, each rows, collection errors', async () => {
    const list = await listTests({ runner: 'jest', cwd, args: ['--config', 'jest.config.cjs'] });
    expect(list.files).toEqual(['tests/a.e2e.js', 'tests/b.e2e.js', 'tests/c.e2e.js']);
    expect(list.tests.map((t) => t.path.join(' > '))).toEqual(['outer > inner > passes', 'outer > fails', 'outer > skipped', 'outer > todo', 'outer > each 1', 'outer > each 2', 'top level']);
    expect(list.tests[0]).toMatchObject({ id: jestTestId('tests/a.e2e.js', ['outer', 'inner', 'passes']), line: 4 });
    expect(list.errors).toEqual([{ file: 'tests/b.e2e.js', message: expect.stringContaining('boom while collecting') }]);
  }, 60_000);

  it('the collect-only arguments come after the user’s (--reporters would swallow paths after it)', () => {
    expect(listArgs(['--out', 'o.json', '--config', 'j.cjs', 'e2e'])).toEqual({ out: 'o.json', rest: ['--config', 'j.cjs', 'e2e'] });
    const args = collectOnlyArgs(['--config', 'j.cjs', 'e2e']);
    expect(args.slice(0, 3)).toEqual(['--config', 'j.cjs', 'e2e']);
    expect(args).toEqual(expect.arrayContaining(['--testNamePattern', '(?!)', '--testLocationInResults']));
    expect(args.at(-2)).toBe('--reporters');
  });
});
