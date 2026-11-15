/**
 * `@quiesco/vitest/reporter`: sends run events to `quiesco test` / `quiesco ui` (progress bar, test UI)
 * from Vitest's main process (findings P0, vitest 5.1.0). Added to the run by `quiescoPlugin()` from
 * `@quiesco/vitest/config` — the command line `--reporter` would replace the user's reporters. Without
 * QUIESCO_EVENTS it does nothing.
 *
 * - Total: estimated at the start from a static parse of the files (nothing executes; `test.each`
 *   counts once), then corrected per file once Vitest has collected it.
 * - Worker: the file's `concurrencyId` (1…N, the worker slot) − 1.
 * - Test id: Vitest's own test id (stable across runs of the same file).
 */
import path from 'node:path';

import { connectRunEvents } from '@quiesco/core';
import type { RunError, RunEventClient, TestRef } from '@quiesco/core';
import type { Reporter, SerializedError, TestCase, TestModule, TestRunEndReason, TestSpecification, Vitest } from 'vitest/node';

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

export function testRef(test: TestCase, root: string): TestRef {
  const titles = [test.name];
  for (let p = test.parent; p.type === 'suite'; p = p.parent) titles.unshift(p.name);
  return { id: test.id, file: relative(root, test.module.moduleId), ...(test.location !== undefined ? { line: test.location.line } : {}), name: test.name, path: titles };
}

function runError(e: { message?: string; stack?: string; diff?: string } | undefined): RunError | undefined {
  if (e === undefined) return undefined;
  return { message: e.message ?? 'Error', ...(e.stack !== undefined ? { stack: e.stack } : {}), ...(e.diff !== undefined ? { diff: e.diff } : {}) };
}

function countTests(m: TestModule): number {
  return [...m.children.allTests()].length;
}

function worker(m: TestModule): number | undefined {
  const id = m.diagnostic().concurrencyId;
  return id >= 1 ? id - 1 : undefined;
}

export default class QuiescoReporter implements Reporter {
  private client: RunEventClient | null = null;
  private vitest: Vitest | null = null;
  private root = process.cwd();
  /** Tests per file: the static estimate until the file is collected. */
  private readonly perFile = new Map<string, { count: number; exact: boolean }>();
  private startedAt = 0;

  onInit(vitest: Vitest): void {
    this.vitest = vitest;
    this.root = vitest.config.root;
  }

  /** One connection per run: closed at the run's end so its last events are flushed before Vitest exits. */
  async onTestRunStart(specifications: ReadonlyArray<TestSpecification>): Promise<void> {
    const client = connectRunEvents({ runner: 'vitest', ...(this.vitest !== null ? { runnerVersion: this.vitest.version } : {}) });
    if (!client.enabled) return;
    this.client = client;
    this.startedAt = Date.now();
    this.perFile.clear();
    const files = [...new Set(specifications.map((s) => s.moduleId))];
    let modules: TestModule[] = [];
    try {
      modules = this.vitest !== null ? await this.vitest.parseSpecifications([...specifications]) : [];
    } catch {
      // The estimate is a nicety: without it the total grows as files are collected.
    }
    for (const m of modules) this.perFile.set(m.moduleId, { count: countTests(m), exact: false });
    const maxWorkers = this.vitest?.config.maxWorkers;
    this.client.send({
      type: 'run:start',
      total: this.total(),
      totalIsEstimate: true,
      files: files.map((f) => relative(this.root, f)),
      ...(typeof maxWorkers === 'number' ? { workers: maxWorkers } : {}),
    });
  }

  onTestModuleCollected(m: TestModule): void {
    if (this.client === null) return;
    this.perFile.set(m.moduleId, { count: countTests(m), exact: true });
    this.client.send({ type: 'total:update', total: this.total(), totalIsEstimate: [...this.perFile.values()].some((f) => !f.exact) });
  }

  onTestModuleStart(m: TestModule): void {
    this.client?.send({ type: 'file:start', file: relative(this.root, m.moduleId) });
  }

  onTestModuleEnd(m: TestModule): void {
    if (this.client === null) return;
    const error = m.state() === 'failed' && countTests(m) === 0 ? runError(m.errors()[0]) : undefined;
    this.client.send({ type: 'file:end', file: relative(this.root, m.moduleId), ...(error !== undefined ? { error } : {}) });
  }

  onTestCaseReady(test: TestCase): void {
    if (this.client === null) return;
    const w = worker(test.module);
    this.client.send({ type: 'test:start', test: testRef(test, this.root), attempt: 0, startedAt: test.diagnostic()?.startTime ?? Date.now(), ...(w !== undefined ? { worker: w } : {}) });
  }

  onTestCaseResult(test: TestCase): void {
    if (this.client === null) return;
    const r = test.result();
    const status = test.options.mode === 'todo' ? 'todo' : r.state === 'pending' ? 'skipped' : r.state;
    const error = r.state === 'failed' ? runError(r.errors[0]) : undefined;
    const logs = test.logs().map((l) => ({ stream: l.type, text: l.content }));
    const w = worker(test.module);
    this.client.send({
      type: 'test:end',
      test: testRef(test, this.root),
      status,
      durationMs: Math.round(test.diagnostic()?.duration ?? 0),
      willRetry: false, // Vitest retries inside the test and reports once
      ...(error !== undefined ? { error } : {}),
      ...(logs.length > 0 ? { logs } : {}),
      ...(w !== undefined ? { worker: w } : {}),
    });
  }

  async onTestRunEnd(_modules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<SerializedError>, reason: TestRunEndReason): Promise<void> {
    const client = this.client;
    if (client === null) return;
    for (const e of unhandledErrors) {
      const error = runError(e);
      if (error !== undefined) client.send({ type: 'run:error', error });
    }
    client.send({ type: 'run:end', success: reason === 'passed', interrupted: reason === 'interrupted', durationMs: Date.now() - this.startedAt });
    this.client = null;
    await client.close();
  }

  private total(): number {
    let n = 0;
    for (const f of this.perFile.values()) n += f.count;
    return n;
  }
}
