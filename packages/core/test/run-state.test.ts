import type { RunEvent, TestRef } from '@quiesco/protocol';
import { describe, expect, it } from 'vitest';

import { RunState } from '../src/run-state';

const t = (id: string): TestRef => ({ id, file: 'e2e/a.test.ts', name: id, path: [id] });
const start = (id: string, worker?: number): RunEvent => ({ type: 'test:start', test: t(id), attempt: 0, startedAt: 0, ...(worker !== undefined ? { worker } : {}) });
const end = (id: string, status: 'passed' | 'failed' | 'skipped' | 'todo' = 'passed', willRetry = false): RunEvent => ({ type: 'test:end', test: t(id), status, durationMs: 5, willRetry });


describe('RunState', () => {
  it('counts finished tests, keeps the running ones and the elapsed time', () => {
    let now = 1000;
    const s = new RunState(() => now);
    s.apply({ type: 'hello', protocol: 1, runner: 'cucumber', pid: 1 });
    s.apply({ type: 'run:start', total: 3, totalIsEstimate: false, files: ['e2e/a.test.ts'] });
    s.apply(start('a', 0));
    s.apply(start('b', 1));
    s.apply(end('a'));
    expect(s.runner).toBe('cucumber');
    expect(s.phase).toBe('running');
    expect(s.done).toBe(1);
    expect([...s.running.keys()]).toEqual(['b']);
    expect(s.counts.passed).toBe(1);
    expect(s.tests.get('b')).toMatchObject({ status: 'running', worker: 1 });
    now = 4000;
    expect(s.elapsedMs).toBe(3000);
  });

  it('a retried attempt is not counted until the last attempt', () => {
    const s = new RunState();
    s.apply({ type: 'run:start', total: 1, totalIsEstimate: false, files: [] });
    s.apply(start('a'));
    s.apply(end('a', 'failed', true));
    expect(s.done).toBe(0);
    expect(s.tests.get('a')?.status).toBe('queued');
    s.apply(start('a'));
    s.apply(end('a', 'passed'));
    expect(s.done).toBe(1);
    expect(s.counts).toMatchObject({ passed: 1, failed: 0 });
  });

  it('the total never drops below done + running; estimates are approximate until the run ends', () => {
    const s = new RunState();
    s.apply({ type: 'run:start', total: 0, totalIsEstimate: true, files: [] }); // Jest
    s.apply(start('a'));
    s.apply(end('a'));
    s.apply(start('b'));
    expect(s.total).toBe(2);
    expect(s.totalIsApproximate).toBe(true);
    s.apply({ type: 'total:update', total: 5, totalIsEstimate: false });
    expect(s.total).toBe(5);
    expect(s.totalIsApproximate).toBe(false);
  });

  it('evidence attaches to its test, also when it arrives before the test ends', () => {
    const s = new RunState();
    s.apply({ type: 'run:start', total: 2, totalIsEstimate: false, files: [] });
    s.apply(start('a'));
    s.apply({ type: 'test:evidence', testId: 'a', files: ['/x/a.png'] });
    s.apply(end('a', 'failed'));
    s.apply(start('b'));
    s.apply(end('b', 'failed'));
    s.apply({ type: 'test:evidence', testId: 'b', files: ['/x/b.png'] });
    expect(s.tests.get('a')?.evidence).toEqual(['/x/a.png']);
    expect(s.tests.get('b')?.evidence).toEqual(['/x/b.png']);
  });

  it('run:end marks what is still running as not run; a file or run error fails the run', () => {
    const s = new RunState();
    s.apply({ type: 'run:start', total: 2, totalIsEstimate: false, files: [] });
    s.apply(start('a'));
    s.apply(end('a'));
    s.apply(start('b'));
    s.apply({ type: 'file:end', file: 'e2e/b.test.ts', error: { message: 'SyntaxError' } });
    s.apply({ type: 'run:end', success: true, interrupted: false, durationMs: 1 });
    expect(s.phase).toBe('ended');
    expect(s.counts.notRun).toBe(1);
    expect(s.tests.get('b')?.status).toBe('notRun');
    expect(s.running.size).toBe(0);
    expect(s.success).toBe(false);
  });

  it('runnerExited ends a run that never sent run:end (crash, Ctrl-C), and does nothing after run:end', () => {
    const s = new RunState();
    s.apply({ type: 'run:start', total: 1, totalIsEstimate: false, files: [] });
    s.apply(start('a'));
    s.runnerExited(130);
    expect(s).toMatchObject({ phase: 'ended', interrupted: true, success: false });
    const done = new RunState();
    done.apply({ type: 'run:end', success: true, interrupted: false, durationMs: 1 });
    done.runnerExited(1);
    expect(done.success).toBe(true);
  });

  it('a new run starts over but remembers tests from the earlier one', () => {
    const s = new RunState();
    s.apply({ type: 'run:start', total: 1, totalIsEstimate: false, files: [] });
    s.apply(start('a'));
    s.apply(end('a', 'failed'));
    s.apply({ type: 'run:end', success: false, interrupted: false, durationMs: 1 });
    s.apply({ type: 'run:start', total: 1, totalIsEstimate: false, files: [] });
    expect(s).toMatchObject({ phase: 'running', done: 0, success: null });
    expect(s.counts.failed).toBe(0);
    expect(s.tests.get('a')?.status).toBe('failed');
  });
});
