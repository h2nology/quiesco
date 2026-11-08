/**
 * What the commands need from the outside world, injectable so the commands can be unit-tested
 * without spawning tools or touching a real project.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
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
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  exists(path: string): boolean;
  platform: NodeJS.Platform;
  nodeVersion: string;
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
