import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { loadConfiguration, runCucumber } from '@cucumber/cucumber/api';
import { RUN_EVENTS_ENV, RunEventServer } from '@quiesco/core';
import type { RunEvent, RunEventOf } from '@quiesco/core';
import { afterEach, describe, expect, it } from 'vitest';

import { CucumberRunEvents } from '../src/run-events';
import type { EnvelopeLike } from '../src/run-events';

const cwd = path.resolve(__dirname, 'fixtures/project');
const sink = () => new Writable({ write: (_c, _e, cb) => cb() });
const ts = (ms: number) => ({ seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1e6 });

let server: RunEventServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
  delete process.env[RUN_EVENTS_ENV];
});

async function startServer() {
  const received: RunEvent[] = [];
  server = new RunEventServer({ onEvent: (e) => received.push(e) });
  await server.listen();
  return { server, received };
}

const ofType = <K extends RunEvent['type']>(events: readonly RunEvent[], type: K) => events.filter((e): e is RunEventOf<K> => e.type === type);

describe('CucumberRunEvents with a real cucumber-js run', () => {
  it('maps the run: exact total, uri:line ids, rule and outline rows, statuses, errors, evidence', async () => {
    const { server, received } = await startServer();
    process.env[RUN_EVENTS_ENV] = server.address; // the After hook sends evidence from the "worker"
    const { runConfiguration } = await loadConfiguration(
      { provided: { paths: ['features/**/*.feature'], import: ['features/support/**/*.mjs'], format: [] } },
      { cwd, stdout: sink(), stderr: sink() },
    );
    const mapper = new CucumberRunEvents();
    const events: RunEvent[] = [];
    await runCucumber(runConfiguration, { cwd, stdout: sink(), stderr: sink() }, (e) => events.push(...mapper.push(e as EnvelopeLike)));
    await server.drain();

    expect(events[0]).toMatchObject({ type: 'run:start', total: 10, totalIsEstimate: false, files: ['features/platforms.feature', 'features/todo.feature'] });
    expect(events.at(-1)).toMatchObject({ type: 'run:end', success: false, interrupted: false });

    const ends = new Map(ofType(events, 'test:end').map((e) => [e.test.id, e]));
    expect(ends.size).toBe(10);
    expect(ofType(events, 'test:start')).toHaveLength(10);
    expect(ends.get('features/todo.feature:3')).toMatchObject({ status: 'passed', test: { file: 'features/todo.feature', line: 3, name: 'runs everywhere', path: ['Quiesco wiring', 'runs everywhere'] } });
    expect(ends.get('features/todo.feature:8')?.status).toBe('skipped'); // @web on android
    const failed = ends.get('features/todo.feature:15');
    expect(failed).toMatchObject({ status: 'failed', willRetry: false, error: { message: expect.stringContaining('No element matches { id: "broken" }') } });
    // A scenario in a Rule: the rule's title is part of the path.
    expect(ends.get('features/platforms.feature:15')?.test.path).toEqual(['Platform tags, innermost level wins', 'web rule', 'android inside a web rule']);
    // Scenario Outline: one test per Examples row, addressed by the row's line, name interpolated.
    expect(ends.get('features/platforms.feature:28')).toMatchObject({ status: 'passed', test: { name: 'examples decide ex-android', line: 28 } });
    expect(ends.get('features/platforms.feature:32')).toMatchObject({ status: 'skipped', test: { name: 'examples decide ex-ios' } });

    expect(ofType(received, 'test:evidence')).toEqual([{ type: 'test:evidence', testId: 'features/todo.feature:15', files: ['/artifacts/fails-with-evidence/failure.png'] }]);
  });
});

describe('CucumberRunEvents edge cases (envelopes by hand)', () => {
  const doc: EnvelopeLike = { gherkinDocument: { uri: 'f.feature', feature: { name: 'F', children: [{ scenario: { id: 's1', name: 'S', location: { line: 3 }, examples: [] } }] } } };
  const pickle: EnvelopeLike = { pickle: { id: 'p1', uri: 'f.feature', name: 'S', astNodeIds: ['s1'] } };

  it('a retried attempt is marked willRetry, the line comes from the AST when the pickle has none', () => {
    const m = new CucumberRunEvents();
    const out = [doc, pickle, { testRunStarted: { timestamp: ts(1000) } }, { testCase: { id: 'c1', pickleId: 'p1' } }]
      .concat([0, 1].flatMap((attempt) => [
        { testCaseStarted: { id: `st${attempt}`, testCaseId: 'c1', attempt, timestamp: ts(2000 + attempt * 100) } },
        { testStepFinished: { testCaseStartedId: `st${attempt}`, testStepResult: { status: attempt === 0 ? 'FAILED' : 'PASSED', message: 'flaky' } } },
        { testCaseFinished: { testCaseStartedId: `st${attempt}`, timestamp: ts(2050 + attempt * 100), willBeRetried: attempt === 0 } },
      ]))
      .flatMap((e) => m.push(e as EnvelopeLike));
    const ends = ofType(out, 'test:end');
    expect(ends.map((e) => [e.test.id, e.status, e.willRetry, e.durationMs])).toEqual([
      ['f.feature:3', 'failed', true, 50],
      ['f.feature:3', 'passed', false, 50],
    ]);
    expect(ofType(out, 'test:start').map((e) => e.attempt)).toEqual([0, 1]);
  });

  it('a failed BeforeAll: run:error, then run:start with 0 tests and run:end', () => {
    const m = new CucumberRunEvents();
    const out = [
      doc,
      pickle,
      { testRunStarted: { timestamp: ts(0) } },
      { testRunHookFinished: { result: { status: 'FAILED', exception: { type: 'Error', message: 'device did not boot', stackTrace: 'Error: device did not boot\n    at …' } } } },
      { testRunFinished: { success: false, timestamp: ts(500) } },
    ].flatMap((e) => m.push(e as EnvelopeLike));
    expect(out).toEqual([
      { type: 'run:error', error: { message: 'device did not boot', stack: 'Error: device did not boot\n    at …' } },
      { type: 'run:start', total: 0, totalIsEstimate: false, files: [] },
      { type: 'run:end', success: false, interrupted: false, durationMs: 500 },
    ]);
  });

  it('parallel workers: the worker index comes from workerId; this.log() output becomes the test logs', () => {
    const m = new CucumberRunEvents();
    const out = [
      doc,
      pickle,
      { testCase: { id: 'c1', pickleId: 'p1' } },
      { testCaseStarted: { id: 'st', testCaseId: 'c1', attempt: 0, workerId: '1', timestamp: ts(0) } },
      { attachment: { testCaseStartedId: 'st', mediaType: 'text/x.cucumber.log+plain', body: 'hello', contentEncoding: 'IDENTITY' } },
      { attachment: { testCaseStartedId: 'st', mediaType: 'image/png', body: 'xx', contentEncoding: 'BASE64' } },
      { testCaseFinished: { testCaseStartedId: 'st', timestamp: ts(10), willBeRetried: false } },
    ].flatMap((e) => m.push(e as EnvelopeLike));
    expect(ofType(out, 'test:start')[0]?.worker).toBe(1);
    expect(ofType(out, 'test:end')[0]).toMatchObject({ status: 'passed', worker: 1, logs: [{ stream: 'stdout', text: 'hello' }] });
  });
});

describe('@quiesco/cucumber/events through the cucumber-js command line', () => {
  it('sends events while the user’s stdout formatter keeps working (file target /dev/null)', async () => {
    const { server, received } = await startServer();
    const require = createRequire(import.meta.url);
    const bin = path.join(path.dirname(require.resolve('@cucumber/cucumber/package.json')), 'bin', 'cucumber.js');
    const formatter = pathToFileURL(path.resolve(__dirname, '../dist/events-formatter.js')).href;
    const target = process.platform === 'win32' ? path.join(cwd, '.quiesco-events.out') : '/dev/null';
    // Plain output to match on, also under FORCE_COLOR.
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...server.env(), NO_COLOR: '1' };
    delete childEnv['FORCE_COLOR'];
    let stdout = '';
    const code = await new Promise<number | null>((resolve) => {
      const p = spawn(process.execPath, [bin, 'features/todo.feature', '--import', 'features/support/**/*.mjs', '--format', 'progress', '--format', `"${formatter}":"${target}"`], {
        cwd,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      p.on('exit', resolve);
    });
    await server.drain();
    expect(code).toBe(1); // "fails with evidence"
    expect(stdout).toMatch(/4 scenarios \(2 passed, 1 skipped, 1 failed\)/);
    expect(received.map((e) => e.type)).toEqual(expect.arrayContaining(['hello', 'run:start', 'test:start', 'test:end', 'test:evidence', 'run:end']));
    expect(received.find((e) => e.type === 'hello')).toMatchObject({ runner: 'cucumber' });
    expect(ofType(received, 'run:start')[0]?.total).toBe(4);
    expect(ofType(received, 'test:end')).toHaveLength(4);
  });
});
