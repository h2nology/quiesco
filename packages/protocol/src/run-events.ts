/**
 * Run events: what a test runner's Quiesco reporter tells the `quiesco` process while tests run (the
 * progress bar and `quiesco ui`). Runner independent: the cucumber formatter, the Vitest reporter and
 * the Jest reporter all map their own events onto these.
 *
 * Wire format: NDJSON (one JSON object per line) over a local socket whose address the CLI passes in
 * the QUIESCO_EVENTS environment variable (a Unix socket path, or a `\\.\pipe\…` name on Windows).
 * Without the variable a reporter sends nothing.
 *
 * Several connections may send events for one run: the reporter in the runner's main process, and
 * test workers that add evidence (`test:evidence`). Tests are matched by `id`.
 */

/** Bumped on any incompatible change to the run events. Sent in `hello`. */
export const RUN_EVENTS_PROTOCOL = 1;

/** Environment variable holding the socket address. */
export const RUN_EVENTS_ENV = 'QUIESCO_EVENTS';

export type RunnerName = 'cucumber' | 'vitest' | 'jest';

/**
 * - `pending`: Jest's skipped tests, cucumber's pending steps.
 * - `undefined`: cucumber, a step without a definition.
 * - `notRun`: never finished (the run ended or was interrupted first). Set by the consumer, never sent.
 */
export type TestStatus = 'passed' | 'failed' | 'skipped' | 'todo' | 'pending' | 'undefined' | 'notRun';

export interface TestRef {
  /**
   * Stable across runs of the same files: cucumber `uri:line`; Vitest its test id; Jest the file and
   * the title path joined with NUL.
   */
  id: string;
  /** Path relative to the project root, `/`-separated. */
  file: string;
  /** 1-based line of the test (the Examples row for a Scenario Outline), when the runner knows it. */
  line?: number;
  /** The test's own title. */
  name: string;
  /** Group titles and the test title, outermost first (cucumber: [feature, rule?, scenario]). */
  path: readonly string[];
}

export interface RunError {
  message: string;
  stack?: string;
  /** Expected / actual difference, already formatted by the runner. */
  diff?: string;
}

export interface RunCounts {
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  pending: number;
  undefined: number;
  notRun: number;
}

export interface RunEvents {
  /** First event on every connection. */
  hello: { protocol: number; runner: RunnerName; runnerVersion?: string; pid: number };
  /**
   * The run starts. `total` is what the runner knows at this point: exact for cucumber, an estimate for
   * Vitest (static parse), the number of tests known so far for Jest (0). `files` are the test files.
   */
  'run:start': { total: number; totalIsEstimate: boolean; files: readonly string[]; workers: number };
  /** A better total (a file was collected). */
  'total:update': { total: number; totalIsEstimate: boolean };
  'file:start': { file: string };
  /** `error`: the file failed outside any test (syntax error, error while collecting, BeforeAll). */
  'file:end': { file: string; error?: RunError };
  'test:start': { test: TestRef; worker?: number; attempt: number; startedAt: number };
  'test:end': {
    test: TestRef;
    status: Exclude<TestStatus, 'notRun'>;
    durationMs: number;
    error?: RunError;
    /** The runner will run this test again (retry): do not count it yet. */
    willRetry: boolean;
    /** Console output of the test, when the runner keeps it per test. */
    logs?: readonly { stream: 'stdout' | 'stderr'; text: string }[];
    worker?: number;
  };
  /** Quiesco evidence files of a failed test (absolute paths), sent from the worker that ran it. */
  'test:evidence': { testId: string; files: readonly string[] };
  /** An error outside any file (cucumber BeforeAll, Vitest unhandled errors). */
  'run:error': { error: RunError };
  'run:end': { success: boolean; interrupted: boolean; durationMs: number };
}

export type RunEventType = keyof RunEvents;
export type RunEvent = { [K in RunEventType]: { type: K } & RunEvents[K] }[RunEventType];
export type RunEventOf<K extends RunEventType> = Extract<RunEvent, { type: K }>;

const RUN_EVENT_TYPES: ReadonlySet<string> = new Set<RunEventType>([
  'hello',
  'run:start',
  'total:update',
  'file:start',
  'file:end',
  'test:start',
  'test:end',
  'test:evidence',
  'run:error',
  'run:end',
]);

export function isRunEvent(value: unknown): value is RunEvent {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string' && RUN_EVENT_TYPES.has((value as { type: string }).type);
}

/** One NDJSON line (with its newline). JSON.stringify never emits a raw newline. */
export function encodeRunEvent(event: RunEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export interface RunEventDecoder {
  /** Feed text as it arrives; complete lines are decoded at once. */
  push(chunk: string): void;
  /** The connection ended: decode a last line without its newline. */
  end(): void;
}

/**
 * Splits NDJSON text into events. Lines that are not JSON, or not a known event (a newer reporter),
 * go to `onInvalid` and are skipped: a bad line never stops the stream.
 */
export function createRunEventDecoder(onEvent: (event: RunEvent) => void, onInvalid: (line: string, reason: string) => void = () => {}): RunEventDecoder {
  let buffer = '';
  const line = (text: string) => {
    if (text.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (e) {
      onInvalid(text, (e as Error).message);
      return;
    }
    if (isRunEvent(value)) onEvent(value);
    else onInvalid(text, 'not a known run event');
  };
  return {
    push(chunk) {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) !== -1) {
        const text = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        line(text);
      }
    },
    end() {
      const rest = buffer;
      buffer = '';
      line(rest);
    },
  };
}

export function emptyCounts(): RunCounts {
  return { passed: 0, failed: 0, skipped: 0, todo: 0, pending: 0, undefined: 0, notRun: 0 };
}
