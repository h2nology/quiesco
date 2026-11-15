import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import { RunEventServer } from '@quiesco/core';
import type { Lifecycle, RunEvent, RunEventOf } from '@quiesco/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleEvent } from '../src/events';
import type { TestLike } from '../src/events';
import { jestTestId } from '../src/reporter';

const cwd = path.resolve(__dirname, 'fixtures/events-project');
const ofType = <K extends RunEvent['type']>(events: readonly RunEvent[], type: K) => events.filter((e): e is RunEventOf<K> => e.type === type);

let server: RunEventServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe('@quiesco/jest/reporter in a real Jest run', () => {
  it('sends per-test events, the skipped tests from the file results, file errors and a growing total', async () => {
    const received: RunEvent[] = [];
    server = new RunEventServer({ onEvent: (e) => received.push(e) });
    await server.listen();
    const require = createRequire(import.meta.url);
    const bin = path.join(path.dirname(require.resolve('jest/package.json')), 'bin', 'jest.js');
    let output = '';
    const code = await new Promise<number | null>((resolve) => {
      const p = spawn(process.execPath, [bin, '--config', 'jest.config.cjs', '--runInBand', '--testLocationInResults'], { cwd, env: { ...process.env, ...server?.env(), CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      p.stdout.on('data', (d: Buffer) => (output += d.toString()));
      p.stderr.on('data', (d: Buffer) => (output += d.toString()));
      p.on('exit', resolve);
    });
    await server.drain();
    expect(code).toBe(1);
    expect(output).toMatch(/Tests:\s+1 failed, 1 skipped, 1 todo, 4 passed, 7 total/); // the 'default' reporter still ran

    expect(received[0]).toMatchObject({ type: 'hello', runner: 'jest' });
    expect(ofType(received, 'run:start')[0]).toMatchObject({ total: 0, totalIsEstimate: true });
    expect(ofType(received, 'total:update').at(-1)).toEqual({ type: 'total:update', total: 7, totalIsEstimate: false });

    const ends = new Map(ofType(received, 'test:end').map((e) => [e.test.path.join(' > '), e]));
    expect(ends.size).toBe(7);
    expect(ends.get('outer > inner > passes')).toMatchObject({ status: 'passed', test: { id: jestTestId('tests/a.e2e.js', ['outer', 'inner', 'passes']), file: 'tests/a.e2e.js', line: 3, name: 'passes' } });
    expect(ends.get('outer > fails')).toMatchObject({ status: 'failed', error: { message: expect.stringContaining('expect(received).toBe(expected)'), stack: expect.stringContaining('Expected: 2') } });
    expect(ends.get('outer > skipped')?.status).toBe('skipped'); // sent from the file result: no per-test events in Jest
    expect(ends.get('outer > todo')?.status).toBe('todo');
    expect(ends.get('outer > each 2')?.status).toBe('passed');
    // Every test that started also ended, exactly once.
    const started = ofType(received, 'test:start').map((e) => e.test.id);
    expect(started.every((id) => ofType(received, 'test:end').filter((e) => e.test.id === id).length === 1)).toBe(true);

    const fileEnds = ofType(received, 'file:end');
    expect(fileEnds.find((e) => e.file === 'tests/b.e2e.js')?.error?.message).toContain('boom while collecting');
    expect(fileEnds.find((e) => e.file === 'tests/c.e2e.js')?.error).toBeUndefined();
    expect(received.at(-1)).toMatchObject({ type: 'run:end', success: false, interrupted: false });
  }, 60_000);
});

describe('handleEvent evidence callback', () => {
  it('passes the evidence files of a finished test (failed or not) to onEvidence', async () => {
    const lifecycle = { running: true, bailedOut: null, runsHere: () => true, before: vi.fn(), after: vi.fn(async () => ({ attachments: [], files: ['/a/failure.png'] })) } as unknown as Lifecycle;
    const test: TestLike = { name: 'adds', parent: { name: 'todos', parent: { name: 'ROOT_DESCRIBE_BLOCK' } }, errors: [new Error('x')] };
    const onEvidence = vi.fn();
    await handleEvent(lifecycle, { name: 'test_done', test }, onEvidence);
    expect(onEvidence).toHaveBeenCalledWith(test, ['/a/failure.png']);
  });
});
