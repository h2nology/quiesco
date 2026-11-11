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

export const spawnProcess: SpawnProcess = (file, args) => spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });

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
