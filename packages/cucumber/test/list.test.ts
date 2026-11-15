import path from 'node:path';

import { listTests } from '@quiesco/core';
import { describe, expect, it } from 'vitest';

import { listScenarios, parseListArgs } from '../src/list';

const cwd = path.resolve(__dirname, 'fixtures/project');

describe('cucumber list', () => {
  it('lists every scenario and Examples row with the ids the run events use, without running anything', async () => {
    const log = ((globalThis as { __quiescoTestLog?: string[] }).__quiescoTestLog ??= []);
    const before = log.length;
    const list = await listScenarios(cwd, { profiles: [], paths: ['features/**/*.feature'] });
    expect(list.runner).toBe('cucumber');
    expect(list.files).toEqual(['features/platforms.feature', 'features/todo.feature']);
    expect(list.tests).toHaveLength(10);
    expect(list.tests.map((t) => t.id)).toEqual(expect.arrayContaining(['features/todo.feature:3', 'features/todo.feature:15', 'features/platforms.feature:15', 'features/platforms.feature:28', 'features/platforms.feature:32']));
    expect(list.tests.find((t) => t.id === 'features/platforms.feature:15')?.path).toEqual(['Platform tags, innermost level wins', 'web rule', 'android inside a web rule']);
    expect(log.length).toBe(before); // no hook or step ran (the fixture logs taps and resets)
  });

  it('a path:line narrows the list', async () => {
    const list = await listScenarios(cwd, { profiles: [], paths: ['features/todo.feature:15'] });
    expect(list.tests.map((t) => t.id)).toEqual(['features/todo.feature:15']);
  });

  it('parses its arguments', () => {
    expect(parseListArgs(['--out', '/tmp/x.json', '--config', 'c.mjs', '-p', 'web', 'features/a.feature'])).toEqual({ out: '/tmp/x.json', config: 'c.mjs', profiles: ['web'], paths: ['features/a.feature'] });
  });

  it('through core listTests (a child process running @quiesco/cucumber/list)', async () => {
    const list = await listTests({ runner: 'cucumber', cwd, args: ['features/todo.feature'] });
    expect(list.errors).toEqual([]);
    expect(list.tests.map((t) => t.name)).toEqual(['runs everywhere', 'web only', 'hard reset', 'fails with evidence']);
  });
});
