/**
 * cucumber-js messages → Quiesco run events (findings P0, cucumber 13.3.0 / 12.x). Structural types
 * only, no cucumber import, so it can be unit-tested with plain envelopes.
 *
 * - Total: the `testCase` envelopes sent before the first `testCaseStarted` (`pickle` envelopes cover
 *   every scenario of the loaded files, before filtering).
 * - Status of a test: the most severe step result (hooks included).
 * - Test id: `uri:line` (cucumber's own ids are fresh UUIDs on every run); the line is the scenario's, or
 *   the Examples row's for a Scenario Outline.
 */
import type { RunError, RunEvent, TestRef, TestStatus } from '@quiesco/core';

interface Timestamp {
  seconds: number;
  nanos: number;
}
interface Location {
  line: number;
}
interface Exception {
  type?: string;
  message?: string;
  stackTrace?: string;
}
interface StepResult {
  status: string;
  message?: string;
  exception?: Exception;
}
interface Scenario {
  id: string;
  name: string;
  location: Location;
  examples: readonly { tableBody: readonly { id: string; location: Location }[] }[];
}
interface Rule {
  id: string;
  name: string;
  children: readonly FeatureChild[];
}
interface FeatureChild {
  rule?: Rule;
  scenario?: Scenario;
}
export interface DocumentLike {
  uri?: string;
  feature?: { name: string; children: readonly FeatureChild[] };
}
export interface PickleLike {
  id: string;
  uri: string;
  name: string;
  location?: Location;
  astNodeIds: readonly string[];
}

/** The parts of a cucumber Envelope used here. */
export interface EnvelopeLike {
  gherkinDocument?: DocumentLike;
  pickle?: PickleLike;
  testRunStarted?: { timestamp: Timestamp };
  testCase?: { id: string; pickleId: string };
  testCaseStarted?: { id: string; testCaseId: string; attempt: number; workerId?: string; timestamp: Timestamp };
  testStepFinished?: { testCaseStartedId: string; testStepResult: StepResult };
  testCaseFinished?: { testCaseStartedId: string; timestamp: Timestamp; willBeRetried: boolean };
  attachment?: { testCaseStartedId?: string; mediaType: string; body: string; contentEncoding?: string };
  testRunHookFinished?: { result: StepResult };
  testRunFinished?: { success: boolean; timestamp: Timestamp; message?: string; exception?: Exception };
}

const SEVERITY = ['UNKNOWN', 'PASSED', 'SKIPPED', 'PENDING', 'UNDEFINED', 'AMBIGUOUS', 'FAILED'];
const STATUS: Record<string, Exclude<TestStatus, 'notRun'>> = {
  UNKNOWN: 'passed',
  PASSED: 'passed',
  SKIPPED: 'skipped',
  PENDING: 'pending',
  UNDEFINED: 'undefined',
  AMBIGUOUS: 'failed',
  FAILED: 'failed',
};
/** cucumber's `this.log()` output. */
const LOG_MEDIA_TYPE = 'text/x.cucumber.log+plain';

const ms = (t: Timestamp) => t.seconds * 1000 + t.nanos / 1e6;

function errorOf(r: { message?: string; exception?: Exception }): RunError | undefined {
  const message = r.exception?.message ?? r.message;
  if (message === undefined) return undefined;
  const stack = r.exception?.stackTrace ?? (r.message !== undefined && r.message !== message ? r.message : undefined);
  return stack !== undefined ? { message, stack } : { message };
}

/** Where each scenario / Examples row is, and the titles above it: [feature, rule?]. */
class DocumentIndex {
  private readonly nodes = new Map<string, { line: number; parents: string[] }>();

  add(doc: DocumentLike): void {
    const feature = doc.feature;
    if (feature === undefined) return;
    const walk = (children: readonly FeatureChild[], parents: string[]) => {
      for (const c of children) {
        if (c.rule !== undefined) walk(c.rule.children, [...parents, c.rule.name]);
        if (c.scenario !== undefined) {
          this.nodes.set(c.scenario.id, { line: c.scenario.location.line, parents });
          for (const ex of c.scenario.examples) for (const row of ex.tableBody) this.nodes.set(row.id, { line: row.location.line, parents });
        }
      }
    };
    walk(feature.children, [feature.name]);
  }

  /** The test a pickle is: line from the pickle (cucumber ≥ 12.x with messages that carry it) or the AST. */
  ref(p: PickleLike): TestRef {
    const scenario = this.nodes.get(p.astNodeIds[0] ?? '');
    const last = this.nodes.get(p.astNodeIds.at(-1) ?? '');
    const line = p.location?.line ?? last?.line ?? scenario?.line;
    const path = [...(scenario?.parents ?? []), p.name].filter((t) => t !== '');
    return { id: line !== undefined ? `${p.uri}:${line}` : `${p.uri}:${p.name}`, file: p.uri, ...(line !== undefined ? { line } : {}), name: p.name, path };
  }
}

export function pickleTestId(p: PickleLike, doc: DocumentLike | undefined): string {
  const index = new DocumentIndex();
  if (doc !== undefined) index.add(doc);
  return index.ref(p).id;
}

interface Running {
  ref: TestRef;
  startedAt: number;
  worker: number | undefined;
  worst: StepResult;
  logs: { stream: 'stdout' | 'stderr'; text: string }[];
}

/** Feed it envelopes in order; it returns the run events each one produces. */
export class CucumberRunEvents {
  private readonly docs = new DocumentIndex();
  private readonly pickles = new Map<string, PickleLike>();
  private readonly testCases = new Map<string, string>();
  private readonly running = new Map<string, Running>();
  private planned: string[] | null = [];
  private runStartedAt: number | null = null;

  constructor(private readonly workers?: number) {}

  push(e: EnvelopeLike): RunEvent[] {
    if (e.gherkinDocument !== undefined) this.docs.add(e.gherkinDocument);
    else if (e.pickle !== undefined) this.pickles.set(e.pickle.id, e.pickle);
    else if (e.testRunStarted !== undefined) this.runStartedAt = ms(e.testRunStarted.timestamp);
    else if (e.testCase !== undefined) {
      this.testCases.set(e.testCase.id, e.testCase.pickleId);
      this.planned?.push(e.testCase.id);
    } else if (e.testCaseStarted !== undefined) return this.started(e.testCaseStarted);
    else if (e.testStepFinished !== undefined) {
      const r = this.running.get(e.testStepFinished.testCaseStartedId);
      const next = e.testStepFinished.testStepResult;
      if (r !== undefined && SEVERITY.indexOf(next.status) > SEVERITY.indexOf(r.worst.status)) r.worst = next;
    } else if (e.attachment !== undefined) {
      const a = e.attachment;
      const r = a.testCaseStartedId !== undefined ? this.running.get(a.testCaseStartedId) : undefined;
      if (r !== undefined && a.mediaType === LOG_MEDIA_TYPE) r.logs.push({ stream: 'stdout', text: a.contentEncoding === 'BASE64' ? Buffer.from(a.body, 'base64').toString('utf8') : a.body });
    } else if (e.testCaseFinished !== undefined) return this.finished(e.testCaseFinished);
    else if (e.testRunHookFinished !== undefined) {
      const r = e.testRunHookFinished.result;
      const error = errorOf(r);
      if (r.status === 'FAILED' && error !== undefined) return [{ type: 'run:error', error }];
    } else if (e.testRunFinished !== undefined) {
      const f = e.testRunFinished;
      const out = this.runStart();
      const error = f.success ? undefined : errorOf(f);
      if (error !== undefined) out.push({ type: 'run:error', error });
      out.push({ type: 'run:end', success: f.success, interrupted: false, durationMs: this.runStartedAt !== null ? Math.round(ms(f.timestamp) - this.runStartedAt) : 0 });
      return out;
    }
    return [];
  }

  private ref(testCaseId: string): TestRef | undefined {
    const p = this.pickles.get(this.testCases.get(testCaseId) ?? '');
    return p !== undefined ? this.docs.ref(p) : undefined;
  }

  /** `run:start` once, when the plan is complete (first test, or the end of a run without tests). */
  private runStart(): RunEvent[] {
    if (this.planned === null) return [];
    const refs = this.planned.flatMap((id) => this.ref(id) ?? []);
    this.planned = null;
    const files = [...new Set(refs.map((r) => r.file))];
    return [{ type: 'run:start', total: refs.length, totalIsEstimate: false, files, ...(this.workers !== undefined ? { workers: this.workers } : {}) }];
  }

  private started(s: NonNullable<EnvelopeLike['testCaseStarted']>): RunEvent[] {
    const out = this.runStart();
    const ref = this.ref(s.testCaseId);
    if (ref === undefined) return out;
    const worker = s.workerId !== undefined && /^\d+$/.test(s.workerId) ? Number(s.workerId) : undefined;
    const startedAt = ms(s.timestamp);
    this.running.set(s.id, { ref, startedAt, worker, worst: { status: 'UNKNOWN' }, logs: [] });
    out.push({ type: 'test:start', test: ref, attempt: s.attempt, startedAt, ...(worker !== undefined ? { worker } : {}) });
    return out;
  }

  private finished(f: NonNullable<EnvelopeLike['testCaseFinished']>): RunEvent[] {
    const r = this.running.get(f.testCaseStartedId);
    if (r === undefined) return [];
    this.running.delete(f.testCaseStartedId);
    const status = STATUS[r.worst.status] ?? 'failed';
    const error = status === 'passed' || status === 'skipped' ? undefined : errorOf(r.worst);
    return [
      {
        type: 'test:end',
        test: r.ref,
        status,
        durationMs: Math.max(0, Math.round(ms(f.timestamp) - r.startedAt)),
        willRetry: f.willBeRetried,
        ...(error !== undefined ? { error } : {}),
        ...(r.logs.length > 0 ? { logs: r.logs } : {}),
        ...(r.worker !== undefined ? { worker: r.worker } : {}),
      },
    ];
  }
}
