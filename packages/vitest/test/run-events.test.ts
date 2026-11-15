import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import { RunEventServer } from '@quiesco/core';
import type { RunEvent, RunEventOf } from '@quiesco/core';
import { afterEach, describe, expect, it } from 'vitest';

import { quiesco, quiescoPlugin } from '../src/config';

const cwd = path.resolve(__dirname, 'fixtures/events-project');
const ofType = <K extends RunEvent['type']>(events: readonly RunEvent[], type: K) => events.filter((e): e is RunEventOf<K> => e.type === type);

let server: RunEventServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function runVitest(args: readonly string[], env: NodeJS.ProcessEnv) {
  const require = createRequire(import.meta.url);
  const bin = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  let stdout = '';
  const code = await new Promise<number | null>((resolve) => {
    // Plain output to match on: FORCE_COLOR (set in GitHub Actions' runs of Vitest) wins over NO_COLOR.
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env, CI: '1', NO_COLOR: '1' };
    delete childEnv['FORCE_COLOR'];
    const p = spawn(process.execPath, [bin, 'run', ...args], { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr.on('data', (d: Buffer) => (stdout += d.toString()));
    p.on('exit', resolve);
  });
  return { code, stdout };
}

describe('quiescoPlugin()', () => {
  it('adds the reporter only when QUIESCO_EVENTS is set, after the configured reporters', () => {
    const reporters: unknown[] = ['dot'];
    const plugin = quiescoPlugin();
    const before = process.env['QUIESCO_EVENTS'];
    try {
      delete process.env['QUIESCO_EVENTS'];
      plugin.configureVitest({ vitest: { config: { reporters } } });
      expect(reporters).toEqual(['dot']);
      process.env['QUIESCO_EVENTS'] = '/tmp/x.sock';
      plugin.configureVitest({ vitest: { config: { reporters } } });
      expect(reporters).toEqual(['dot', [expect.stringMatching(/reporter\.(js|ts)$/), {}]]);
    } finally {
      if (before === undefined) delete process.env['QUIESCO_EVENTS'];
      else process.env['QUIESCO_EVENTS'] = before;
    }
  });

  it('quiesco() turns on task locations (lines for the run events)', () => {
    expect(quiesco().includeTaskLocation).toBe(true);
  });
});

describe('@quiesco/vitest/reporter in a real Vitest run', () => {
  it('sends hello, an estimated then exact total, per-test events with paths, lines, logs and statuses', async () => {
    const received: RunEvent[] = [];
    server = new RunEventServer({ onEvent: (e) => received.push(e) });
    await server.listen();
    const { code, stdout } = await runVitest([], server.env());
    await server.drain();
    expect(code).toBe(1);

    expect(received[0]).toMatchObject({ type: 'hello', runner: 'vitest', runnerVersion: expect.stringMatching(/^\d+\./) });
    const start = ofType(received, 'run:start')[0];
    // 7 tests; the static parse counts the two test.each rows as one (6) until the file is collected.
    expect(start).toMatchObject({ total: 6, totalIsEstimate: true, files: ['tests/a.e2e.mjs', 'tests/b.e2e.mjs'], workers: 1 });
    expect(ofType(received, 'total:update').at(-1)).toEqual({ type: 'total:update', total: 7, totalIsEstimate: false });

    const ends = ofType(received, 'test:end');
    const byName = new Map(ends.map((e) => [e.test.path.join(' > '), e]));
    expect([...byName.keys()].sort()).toEqual(['outer > each 1', 'outer > each 2', 'outer > fails', 'outer > inner > passes', 'outer > skipped', 'outer > todo', 'top level'].sort());
    expect(ends).toHaveLength(7);
    expect(byName.get('outer > inner > passes')).toMatchObject({ status: 'passed', test: { file: 'tests/a.e2e.mjs', line: 5, name: 'passes' }, logs: [{ stream: 'stdout', text: expect.stringContaining('hello from a test') }], worker: 0 });
    expect(byName.get('outer > fails')).toMatchObject({ status: 'failed', willRetry: false, error: { message: expect.stringContaining('expected 1 to be 2') } });
    expect(byName.get('outer > skipped')?.status).toBe('skipped');
    expect(byName.get('outer > todo')?.status).toBe('todo');
    expect(ofType(received, 'test:start').length).toBe(ends.length);
    expect(received.at(-1)).toMatchObject({ type: 'run:end', success: false, interrupted: false });

    // The user's 'dot' reporter still ran.
    expect(stdout).toMatch(/Test Files {2}1 failed \| 1 passed/);
  });

  it('keeps a --reporter given on the command line and adds nothing without QUIESCO_EVENTS', async () => {
    const { stdout } = await runVitest(['--reporter', 'verbose'], {});
    expect(stdout).toContain('✓ tests/a.e2e.mjs:5 > outer > inner > passes');
  });
});
