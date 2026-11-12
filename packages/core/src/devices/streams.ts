/**
 * Long-running device processes for artifacts (Phase 6.9): screen recorders and log streams. The spawner
 * is injected in tests.
 */
import { spawn } from 'node:child_process';

/** What providers use of a child process. */
export interface ChildLike {
  readonly exitCode: number | null;
  stdout: { on(event: 'data', cb: (d: Buffer | string) => void): unknown } | null;
  stderr: { on(event: 'data', cb: (d: Buffer | string) => void): unknown } | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', cb: (code: number | null) => void): unknown;
}

export type SpawnProcess = (file: string, args: readonly string[]) => ChildLike;

/**
 * Child processes a session started that must not outlive it (recorders, log streams, the iOS XCUITest
 * runner). Emulators are spawned detached and are not listed: they are kept for the next run.
 */
const tracked = new Set<{ readonly exitCode: number | null; kill(signal?: NodeJS.Signals): boolean; once(event: 'exit', cb: () => void): unknown }>();

/** List a child for killChildProcessesSync(); it leaves the list when it exits. */
export function trackChildProcess<C extends { readonly exitCode: number | null; kill(signal?: NodeJS.Signals): boolean; once(event: 'exit', cb: () => void): unknown }>(child: C): C {
  tracked.add(child);
  child.once('exit', () => tracked.delete(child));
  return child;
}

/** Pids of the tracked children still running (Jest workers register them for globalTeardown). */
export function trackedChildPids(): number[] {
  return [...tracked].filter((c) => c.exitCode === null).map((c) => (c as { pid?: number }).pid).filter((p): p is number => typeof p === 'number');
}

/**
 * Kill every tracked child that is still running, synchronously (Phase 6.12). For runners that end a
 * worker process without waiting for async teardown: Jest sends SIGTERM and kills the worker about
 * 0.5 s later, so the session's dispose() never finishes (findings 6.12 batch A).
 */
export function killChildProcessesSync(): number {
  let n = 0;
  for (const c of tracked) {
    if (c.exitCode === null) {
      c.kill('SIGKILL');
      n++;
    }
  }
  tracked.clear();
  return n;
}

export const spawnProcess: SpawnProcess = (file, args) => trackChildProcess(spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] }));

/** Lines received from a stream, stamped with the host clock; the oldest dropped beyond `max`. */
export class LogBuffer {
  private readonly lines: { t: number; line: string }[] = [];
  private partial = '';

  constructor(
    private readonly max = 20_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Feed raw output (split into lines; an unfinished last line waits for the rest). */
  write(chunk: Buffer | string): void {
    const text = this.partial + chunk.toString();
    const parts = text.split('\n');
    this.partial = parts.pop() ?? '';
    for (const p of parts) this.push(p.replace(/\r$/, ''));
  }

  push(line: string): void {
    if (line.trim() === '') return;
    this.lines.push({ t: this.now(), line });
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }

  since(t: number): string[] {
    return this.lines.filter((l) => l.t >= t).map((l) => l.line);
  }
}

/** Wait for a child to exit (resolves at once when it already has), at most `timeoutMs`. */
export function exited(child: ChildLike, timeoutMs = 10_000): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
