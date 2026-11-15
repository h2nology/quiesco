import type { TestRef } from '@quiesco/protocol';
import { describe, expect, it } from 'vitest';

import { targetArgs } from '../src/targets';

const refs: TestRef[] = [
  { id: 'features/a.feature:3', file: 'features/a.feature', line: 3, name: 'adds', path: ['Todos', 'adds'] },
  { id: 'features/a.feature:9', file: 'features/a.feature', line: 9, name: 'edits', path: ['Todos', 'edits'] },
  { id: 'features/b.feature:4', file: 'features/b.feature', line: 4, name: 'logs in', path: ['Login', 'logs in'] },
  { id: 'j1', file: 'e2e/a.test.js', line: 5, name: 'saves (draft) [x]', path: ['todos', 'saves (draft) [x]'] },
  { id: 'j2', file: 'e2e/b.test.js', line: 2, name: 'top', path: ['top'] },
  { id: 'nl', file: 'e2e/c.test.ts', name: 'no line', path: ['no line'] },
];
const tests = new Map(refs.map((t) => [t.id, t]));

describe('targetArgs', () => {
  it('all tests: no arguments; one file: the file (jest: --runTestsByPath)', () => {
    expect(targetArgs('cucumber', { kind: 'all' }, tests)).toEqual([]);
    expect(targetArgs('vitest', { kind: 'file', file: 'e2e/a.test.ts' }, tests)).toEqual(['e2e/a.test.ts']);
    expect(targetArgs('jest', { kind: 'file', file: 'e2e/a.test.js' }, tests)).toEqual(['--runTestsByPath', 'e2e/a.test.js']);
  });

  it('cucumber: one file:line:line argument per file', () => {
    expect(targetArgs('cucumber', { kind: 'tests', ids: ['features/a.feature:9', 'features/b.feature:4', 'features/a.feature:3'] }, tests)).toEqual(['features/a.feature:3:9', 'features/b.feature:4']);
  });

  it('vitest: one file:line argument per test', () => {
    expect(targetArgs('vitest', { kind: 'tests', ids: ['features/a.feature:9', 'features/a.feature:3'] }, tests)).toEqual(['features/a.feature:3', 'features/a.feature:9']);
  });

  it('jest: the files and an anchored, escaped name pattern', () => {
    expect(targetArgs('jest', { kind: 'tests', ids: ['j1', 'j2'] }, tests)).toEqual(['--runTestsByPath', 'e2e/a.test.js', 'e2e/b.test.js', '-t', '^(todos saves \\(draft\\) \\[x\\]|top)$']);
    expect(new RegExp('^(todos saves \\(draft\\) \\[x\\]|top)$', 'i').test('todos saves (draft) [x]')).toBe(true);
  });

  it('a test without a line runs its whole file; unknown ids are an error', () => {
    expect(targetArgs('vitest', { kind: 'tests', ids: ['nl'] }, tests)).toEqual(['e2e/c.test.ts']);
    expect(() => targetArgs('vitest', { kind: 'tests', ids: ['gone'] }, tests)).toThrow(/none of the chosen tests is known/);
  });
});
