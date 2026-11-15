/**
 * Start a test run as a child process: its output to a callback, stoppable as a whole (the runner runs
 * under npx, so stopping must reach the runner and its workers, not only npx).
 */
import { spawn } from 'node:child_process';

export interface RunHandle {
  /** Resolves with the exit code (130 when stopped with SIGINT). */
  readonly exited: Promise<number>;
  /** Ctrl-C to the whole process tree; SIGKILL after `graceMs` if it is still there. */
  stop(graceMs?: number): void;
}

export interface SpawnRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  onOutput: (stream: 'stdout' | 'stderr', text: string) => void;
}

const isWindows = process.platform === 'win32';

export function spawnRun(command: string, args: readonly string[], options: SpawnRunOptions): RunHandle {
  // Its own process group (POSIX), so stop() reaches npx, the runner and its workers.
  const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], detached: !isWindows, shell: isWindows });
  child.stdout.setEncoding('utf8').on('data', (t: string) => options.onOutput('stdout', t));
  child.stderr.setEncoding('utf8').on('data', (t: string) => options.onOutput('stderr', t));
  const exited = new Promise<number>((resolve) => {
    child.on('error', (e) => {
      options.onOutput('stderr', `${e.message}\n`);
      resolve(127);
    });
    child.on('close', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : signal !== null ? 143 : 1)));
  });
  const signal = (s: NodeJS.Signals) => {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (isWindows) spawn('taskkill', ['/pid', String(child.pid), '/T', ...(s === 'SIGKILL' ? ['/F'] : [])]);
      else process.kill(-child.pid, s);
    } catch {
      // Already gone.
    }
  };
  return {
    exited,
    stop(graceMs = 10_000) {
      signal('SIGINT');
      const timer = setTimeout(() => signal('SIGKILL'), graceMs);
      timer.unref();
      void exited.then(() => clearTimeout(timer));
    },
  };
}
