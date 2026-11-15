/**
 * What the commands need from the outside world, injectable so the commands can be unit-tested
 * without spawning tools or touching a real project.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CliContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  out(line: string): void;
  err(line: string): void;
  /** Run a command to completion and capture its output (doctor checks, package installs). */
  exec(command: string, args: readonly string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<ExecResult>;
  /** Run a command with the terminal attached (cucumber-js); resolves with its exit code. */
  run(command: string, args: readonly string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<number>;
  /** Run a command with stdin attached and its output handed to the callbacks (the progress bar keeps the last line). */
  runPiped(command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; onStdout: (chunk: string) => void; onStderr: (chunk: string) => void }): Promise<number>;
  /** The terminal, when stdout is one (null when piped or redirected). */
  terminal: Terminal | null;
  /** Resolve `specifier` as code in `dir` would (the project's own packages); null when it is not installed. */
  resolveFrom(dir: string, specifier: string): string | null;
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  exists(path: string): boolean;
  platform: NodeJS.Platform;
  nodeVersion: string;
  /** Whether a person is at the terminal (stdout is a TTY), not a CI job. */
  interactive: boolean;
  /** Start a long-running process (Metro) in its own process group, its output appended to `logFile`. */
  spawnBackground(command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; logFile: string }): BackgroundProcess;
  /** GET `url`; null when nothing answers (connection refused, timeout). */
  httpGet(url: string, timeoutMs: number): Promise<{ status: number; body: string } | null>;
  /** Run `cleanup` on Ctrl-C / SIGTERM before exiting; returns a function that removes it. */
  onInterrupt(cleanup: () => Promise<void>): () => void;
  /** Wait (polling a dev server). */
  sleep(ms: number): Promise<void>;
}

export interface Terminal {
  columns(): number;
  /** Whether colors may be used (a color terminal, NO_COLOR not set). */
  color: boolean;
  stdout(text: string): void;
  stderr(text: string): void;
  /** Called on Ctrl-C without exiting (the child gets the signal too and ends the run); returns a remover. */
  onInterrupt(handler: () => void): () => void;
}

export interface BackgroundProcess {
  /** Resolves with the exit code when the process ends. */
  readonly exited: Promise<number>;
  /** Stop it and everything it started (SIGTERM to the group, SIGKILL after `graceMs`). */
  stop(graceMs?: number): Promise<void>;
}

const isWindows = process.platform === 'win32';

export function defaultContext(): CliContext {
  return {
    cwd: process.cwd(),
    env: process.env,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    exec: (command, args, options = {}) =>
      new Promise((resolve) => {
        const child = nodeSpawn(command, [...args], { cwd: options.cwd, env: options.env ?? process.env, shell: isWindows });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
        child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
        child.on('error', (e) => resolve({ code: 127, stdout, stderr: stderr + e.message }));
        child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
      }),
    run: (command, args, options = {}) =>
      new Promise((resolve) => {
        const child = nodeSpawn(command, [...args], { cwd: options.cwd, env: options.env ?? process.env, stdio: 'inherit', shell: isWindows });
        child.on('error', () => resolve(127));
        child.on('close', (code) => resolve(code ?? 1));
      }),
    runPiped: (command, args, options) =>
      new Promise((resolve) => {
        const child = nodeSpawn(command, [...args], { cwd: options.cwd, env: options.env ?? process.env, stdio: ['inherit', 'pipe', 'pipe'], shell: isWindows });
        child.stdout?.setEncoding('utf8').on('data', options.onStdout);
        child.stderr?.setEncoding('utf8').on('data', options.onStderr);
        child.on('error', () => resolve(127));
        child.on('close', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : signal !== null ? 143 : 1)));
      }),
    terminal: process.stdout.isTTY === true ? ttyTerminal() : null,
    resolveFrom: (dir, specifier) => {
      try {
        return createRequire(path.join(dir, 'package.json')).resolve(specifier);
      } catch {
        return null;
      }
    },
    readFile: (p) => {
      try {
        return fs.readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    },
    writeFile: (p, content) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    },
    exists: (p) => fs.existsSync(p),
    platform: process.platform,
    nodeVersion: process.versions.node,
    interactive: process.stdout.isTTY === true,
    spawnBackground: (command, args, options) => {
      fs.mkdirSync(path.dirname(options.logFile), { recursive: true });
      const log = fs.openSync(options.logFile, 'a');
      // Its own process group (detached): `expo start` starts children; stopping the group stops them all.
      const child = nodeSpawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: ['ignore', log, log], detached: !isWindows, shell: isWindows });
      fs.closeSync(log);
      const exited = new Promise<number>((resolve) => {
        child.on('error', () => resolve(127));
        child.on('exit', (code, signal) => resolve(code ?? (signal !== null ? 128 : 1)));
      });
      const signal = (s: NodeJS.Signals) => {
        try {
          if (!isWindows && child.pid !== undefined) process.kill(-child.pid, s);
          else child.kill(s);
        } catch {
          // already gone
        }
      };
      return {
        exited,
        stop: async (graceMs = 5000) => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          signal('SIGTERM');
          const timer = setTimeout(() => signal('SIGKILL'), graceMs);
          await exited;
          clearTimeout(timer);
        },
      };
    },
    httpGet: async (url, timeoutMs) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return { status: r.status, body: await r.text() };
      } catch {
        return null;
      }
    },
    onInterrupt: (cleanup) => {
      const handler = (s: NodeJS.Signals) => {
        void cleanup().finally(() => process.exit(s === 'SIGINT' ? 130 : 143));
      };
      process.once('SIGINT', handler);
      process.once('SIGTERM', handler);
      return () => {
        process.off('SIGINT', handler);
        process.off('SIGTERM', handler);
      };
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

function ttyTerminal(): Terminal {
  return {
    // Some pseudo-terminals report 0 columns.
    columns: () => (process.stdout.columns > 0 ? process.stdout.columns : 80),
    color: process.env['NO_COLOR'] === undefined && process.stdout.hasColors?.() === true,
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    onInterrupt: (handler) => {
      process.on('SIGINT', handler);
      return () => void process.off('SIGINT', handler);
    },
  };
}

/** `--name value` / `--name=value`; returns the value and the remaining arguments. */
export function takeOption(args: readonly string[], name: string): { value: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === name) {
      value = args[i + 1];
      i++;
    } else if (a.startsWith(`${name}=`)) {
      value = a.slice(name.length + 1);
    } else {
      rest.push(a);
    }
  }
  return { value, rest };
}

/** `--flag`; returns whether it was present and the remaining arguments. */
export function takeFlag(args: readonly string[], name: string): { present: boolean; rest: string[] } {
  return { present: args.includes(name), rest: args.filter((a) => a !== name) };
}

export const PLATFORMS = ['ios', 'android', 'web'] as const;
export type CliPlatform = (typeof PLATFORMS)[number];

export function parsePlatform(value: string | undefined): CliPlatform | undefined {
  if (value === undefined) return undefined;
  if ((PLATFORMS as readonly string[]).includes(value)) return value as CliPlatform;
  throw new Error(`Unknown platform "${value}" (ios, android or web)`);
}
