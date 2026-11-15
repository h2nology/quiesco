/**
 * `@quiesco/jest/reporter`: sends run events to `quiesco test` / `quiesco ui` (progress bar, test UI)
 * from Jest's main process (findings P0, jest 30.5.2). The `@quiesco/jest` preset lists it next to
 * `default`; a config with its own `reporters` (which replaces the preset's) adds
 * `'@quiesco/jest/reporter'` itself. Without QUIESCO_EVENTS it does nothing.
 *
 * - Total: Jest knows only the number of files at the start; the total grows as files finish.
 * - Skipped tests (`test.skip`, `-t` mismatches, Quiesco's platform skip) get no per-test events in
 *   Jest: their `test:end` is sent from the file's result.
 * - No worker index: Jest does not tell which worker ran a test.
 * - Test id: file + titles joined with NUL (the same in the test environment for evidence).
 */
import path from 'node:path';

import { connectRunEvents } from '@quiesco/core';
import type { RunError, RunEventClient, TestRef, TestStatus } from '@quiesco/core';

/** Test id shared by the reporter and the test environment. */
export function jestTestId(file: string, titles: readonly string[]): string {
  return [file, ...titles].join('\u0000');
}

export function relativeFile(rootDir: string, file: string): string {
  return path.relative(rootDir, file).split(path.sep).join('/');
}

/** Structural types of the Jest reporter API (no @jest/reporters import, unit-testable). */
export interface JestTest {
  path: string;
}
export interface CaseInfo {
  ancestorTitles: readonly string[];
  title: string;
}
export interface CaseResult extends CaseInfo {
  status: string;
  duration?: number | null;
  failureMessages: readonly string[];
  failureDetails?: readonly unknown[];
  location?: { line: number; column: number } | null;
}
export interface FileResult {
  testResults: readonly CaseResult[];
  testExecError?: { message?: string; stack?: string | null } | null;
}
export interface Aggregated {
  numTotalTests: number;
  numTotalTestSuites: number;
  numFailedTests: number;
  numRuntimeErrorTestSuites: number;
  success: boolean;
  wasInterrupted?: boolean;
  startTime: number;
}

function status(s: string): Exclude<TestStatus, 'notRun'> {
  if (s === 'passed' || s === 'failed' || s === 'todo') return s;
  if (s === 'focused') return 'passed';
  return 'skipped'; // pending, skipped, disabled
}

function errorOf(r: CaseResult): RunError | undefined {
  const formatted = r.failureMessages[0];
  if (formatted === undefined) return undefined;
  const detail = r.failureDetails?.[0] as { message?: unknown } | undefined;
  const message = typeof detail?.message === 'string' ? detail.message : (formatted.split('\n')[0] ?? formatted);
  return { message, stack: formatted };
}

export default class QuiescoReporter {
  private client: RunEventClient | null = null;
  private readonly rootDir: string;
  private readonly ended = new Set<string>();
  private filesDone = 0;

  constructor(globalConfig: { rootDir: string }) {
    this.rootDir = globalConfig.rootDir;
  }

  private ref(test: JestTest, info: CaseInfo, location?: { line: number } | null): TestRef {
    const file = relativeFile(this.rootDir, test.path);
    const titles = [...info.ancestorTitles, info.title];
    return { id: jestTestId(file, titles), file, ...(location != null ? { line: location.line } : {}), name: info.title, path: titles };
  }

  onRunStart(results: Aggregated): void {
    const client = connectRunEvents({ runner: 'jest' });
    if (!client.enabled) return;
    this.client = client;
    this.ended.clear();
    this.filesDone = 0;
    client.send({ type: 'run:start', total: 0, totalIsEstimate: results.numTotalTestSuites > 0, files: [] });
  }

  onTestFileStart(test: JestTest): void {
    this.client?.send({ type: 'file:start', file: relativeFile(this.rootDir, test.path) });
  }

  onTestCaseStart(test: JestTest, info: CaseInfo & { startedAt?: number | null }): void {
    this.client?.send({ type: 'test:start', test: this.ref(test, info), attempt: 0, startedAt: info.startedAt ?? Date.now() });
  }

  onTestCaseResult(test: JestTest, r: CaseResult): void {
    if (this.client === null) return;
    const ref = this.ref(test, r, r.location);
    this.ended.add(ref.id);
    const error = r.status === 'failed' ? errorOf(r) : undefined;
    this.client.send({ type: 'test:end', test: ref, status: status(r.status), durationMs: Math.round(r.duration ?? 0), willRetry: false, ...(error !== undefined ? { error } : {}) });
  }

  onTestFileResult(test: JestTest, result: FileResult, aggregated: Aggregated): void {
    const client = this.client;
    if (client === null) return;
    // Tests Jest skipped without per-test events.
    for (const r of result.testResults) {
      const ref = this.ref(test, r, r.location);
      if (this.ended.has(ref.id)) continue;
      this.ended.add(ref.id);
      client.send({ type: 'test:end', test: ref, status: status(r.status), durationMs: Math.round(r.duration ?? 0), willRetry: false });
    }
    const e = result.testExecError;
    const error = e != null ? { message: e.message ?? 'Test file failed', ...(e.stack != null ? { stack: e.stack } : {}) } : undefined;
    client.send({ type: 'file:end', file: relativeFile(this.rootDir, test.path), ...(error !== undefined ? { error } : {}) });
    this.filesDone++;
    client.send({ type: 'total:update', total: aggregated.numTotalTests, totalIsEstimate: this.filesDone < aggregated.numTotalTestSuites });
  }

  async onRunComplete(_contexts: unknown, results: Aggregated): Promise<void> {
    const client = this.client;
    if (client === null) return;
    this.client = null;
    client.send({ type: 'run:end', success: results.success, interrupted: results.wasInterrupted === true, durationMs: Date.now() - results.startTime });
    await client.close();
  }

  getLastError(): void {}
}
