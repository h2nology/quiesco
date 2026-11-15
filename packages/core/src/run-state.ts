/**
 * The state of a run, built from run events (`@quiesco/protocol` run-events): what the progress bar and
 * `quiesco ui` show. Pure: feed it events with `apply()`, read it back.
 *
 * Several runs in a row (the UI runs again) start over at each `run:start`, keeping what was learned
 * about tests not in the new run.
 */
import { emptyCounts } from '@quiesco/protocol';
import type { RunCounts, RunError, RunEvent, RunEventOf, RunnerName, TestRef, TestStatus } from '@quiesco/protocol';

export interface TestState {
  test: TestRef;
  status: TestStatus | 'running' | 'queued';
  durationMs?: number;
  error?: RunError;
  logs?: readonly { stream: 'stdout' | 'stderr'; text: string }[];
  /** Absolute paths of Quiesco's evidence files (screenshot, element tree, …). */
  evidence?: readonly string[];
  worker?: number;
  attempt?: number;
  startedAt?: number;
}

export interface RunningTest {
  test: TestRef;
  worker?: number;
  startedAt: number;
}

export type RunPhase = 'idle' | 'running' | 'ended';

/** A RunState as plain JSON (`quiesco ui` sends it to a browser that connects mid-run). */
export interface RunStateSnapshot {
  phase: RunPhase;
  runner: RunnerName | null;
  reportedTotal: number;
  totalIsEstimate: boolean;
  workers?: number;
  files: string[];
  counts: RunCounts;
  done: number;
  running: RunningTest[];
  tests: TestState[];
  fileErrors: [string, RunError][];
  runErrors: RunError[];
  success: boolean | null;
  interrupted: boolean;
  startedAt: number | null;
  endedAt: number | null;
}

export class RunState {
  phase: RunPhase = 'idle';
  runner: RunnerName | null = null;
  /** As told by the runner (exact, an estimate, or what is known so far). See `total`. */
  reportedTotal = 0;
  totalIsEstimate = false;
  workers: number | undefined;
  files: string[] = [];
  counts: RunCounts = emptyCounts();
  /** Tests that finished in this run (retries count once, when they stop retrying). */
  done = 0;
  readonly running = new Map<string, RunningTest>();
  /** Every test seen, by id, also from earlier runs. */
  readonly tests = new Map<string, TestState>();
  readonly fileErrors = new Map<string, RunError>();
  readonly runErrors: RunError[] = [];
  success: boolean | null = null;
  interrupted = false;
  /** Epoch ms of `run:start` / `run:end` as seen by this process. */
  startedAt: number | null = null;
  endedAt: number | null = null;
  /** Evidence that arrived before its test ended (the worker can be faster than the reporter). */
  private readonly earlyEvidence = new Map<string, readonly string[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Never below what is already done or running. */
  get total(): number {
    return Math.max(this.reportedTotal, this.done + this.running.size);
  }

  /** The total is not final yet (estimate, or Jest still finding tests). */
  get totalIsApproximate(): boolean {
    return this.totalIsEstimate && this.phase !== 'ended';
  }

  get elapsedMs(): number {
    if (this.startedAt === null) return 0;
    return (this.endedAt ?? this.now()) - this.startedAt;
  }

  apply(event: RunEvent): void {
    switch (event.type) {
      case 'hello':
        this.runner = event.runner;
        break;
      case 'run:start':
        this.start(event);
        break;
      case 'total:update':
        this.reportedTotal = event.total;
        this.totalIsEstimate = event.totalIsEstimate;
        break;
      case 'file:start':
        break;
      case 'file:end':
        if (event.error !== undefined) this.fileErrors.set(event.file, event.error);
        break;
      case 'test:start':
        this.running.set(event.test.id, { test: event.test, startedAt: event.startedAt, ...(event.worker !== undefined ? { worker: event.worker } : {}) });
        this.tests.set(event.test.id, { ...this.tests.get(event.test.id), test: event.test, status: 'running', attempt: event.attempt, startedAt: event.startedAt, ...(event.worker !== undefined ? { worker: event.worker } : {}) });
        break;
      case 'test:end':
        this.end(event);
        break;
      case 'test:evidence': {
        const t = this.tests.get(event.testId);
        if (t !== undefined && t.status !== 'running') t.evidence = event.files;
        else this.earlyEvidence.set(event.testId, event.files);
        break;
      }
      case 'run:error':
        this.runErrors.push(event.error);
        break;
      case 'run:end':
        this.finish(event.success, event.interrupted);
        break;
    }
  }

  snapshot(): RunStateSnapshot {
    return {
      phase: this.phase,
      runner: this.runner,
      reportedTotal: this.reportedTotal,
      totalIsEstimate: this.totalIsEstimate,
      ...(this.workers !== undefined ? { workers: this.workers } : {}),
      files: [...this.files],
      counts: { ...this.counts },
      done: this.done,
      running: [...this.running.values()],
      tests: [...this.tests.values()],
      fileErrors: [...this.fileErrors],
      runErrors: [...this.runErrors],
      success: this.success,
      interrupted: this.interrupted,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };
  }

  static fromSnapshot(s: RunStateSnapshot, now: () => number = Date.now): RunState {
    const state = new RunState(now);
    state.phase = s.phase;
    state.runner = s.runner;
    state.reportedTotal = s.reportedTotal;
    state.totalIsEstimate = s.totalIsEstimate;
    state.workers = s.workers;
    state.files = [...s.files];
    state.counts = { ...s.counts };
    state.done = s.done;
    for (const r of s.running) state.running.set(r.test.id, r);
    for (const t of s.tests) state.tests.set(t.test.id, t);
    for (const [file, e] of s.fileErrors) state.fileErrors.set(file, e);
    state.runErrors.push(...s.runErrors);
    state.success = s.success;
    state.interrupted = s.interrupted;
    state.startedAt = s.startedAt;
    state.endedAt = s.endedAt;
    return state;
  }

  /** The runner process exited (maybe without `run:end`: crash, Ctrl-C). */
  runnerExited(code: number): void {
    if (this.phase === 'ended') return;
    this.finish(code === 0, code === 130 || code === 143);
  }

  private start(e: RunEventOf<'run:start'>): void {
    this.phase = 'running';
    this.reportedTotal = e.total;
    this.totalIsEstimate = e.totalIsEstimate;
    this.workers = e.workers;
    this.files = [...e.files];
    this.counts = emptyCounts();
    this.done = 0;
    this.running.clear();
    this.fileErrors.clear();
    this.runErrors.length = 0;
    this.earlyEvidence.clear();
    this.success = null;
    this.interrupted = false;
    this.startedAt = this.now();
    this.endedAt = null;
  }

  private end(e: RunEventOf<'test:end'>): void {
    this.running.delete(e.test.id);
    const prev = this.tests.get(e.test.id);
    const evidence = this.earlyEvidence.get(e.test.id);
    this.earlyEvidence.delete(e.test.id);
    const state: TestState = {
      test: { ...prev?.test, ...e.test },
      status: e.willRetry ? 'queued' : e.status,
      durationMs: e.durationMs,
      ...(e.error !== undefined ? { error: e.error } : {}),
      ...(e.logs !== undefined ? { logs: e.logs } : {}),
      ...(evidence !== undefined ? { evidence } : {}),
      ...(e.worker !== undefined ? { worker: e.worker } : prev?.worker !== undefined ? { worker: prev.worker } : {}),
      ...(prev?.attempt !== undefined ? { attempt: prev.attempt } : {}),
      ...(prev?.startedAt !== undefined ? { startedAt: prev.startedAt } : {}),
    };
    this.tests.set(e.test.id, state);
    if (e.willRetry) return;
    this.done++;
    this.counts[e.status]++;
  }

  private finish(success: boolean, interrupted: boolean): void {
    if (this.phase === 'idle') this.startedAt = this.now();
    for (const [id, r] of this.running) {
      const t = this.tests.get(id);
      if (t !== undefined) t.status = 'notRun';
      else this.tests.set(id, { test: r.test, status: 'notRun' });
      this.counts.notRun++;
    }
    this.running.clear();
    this.phase = 'ended';
    this.success = success && this.counts.failed === 0 && this.runErrors.length === 0 && this.fileErrors.size === 0;
    this.interrupted = interrupted;
    this.endedAt = this.now();
  }
}
