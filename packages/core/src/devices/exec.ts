import { execFile, spawn } from 'node:child_process';

export interface ExecResult {
  stdout: Buffer;
  stderr: string;
}

/** Run a command; rejects on non-zero exit. Injected in tests. */
export type Exec = (file: string, args: readonly string[], options?: { timeoutMs?: number }) => Promise<ExecResult>;

export const execCommand: Exec = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: options.timeoutMs ?? 120_000 }, (err, stdout, stderr) => {
      if (err !== null) {
        const msg = stderr.toString().trim() || err.message;
        reject(new Error(`${file} ${args.join(' ')} failed: ${msg}`));
        return;
      }
      resolve({ stdout, stderr: stderr.toString() });
    });
  });

/** Start a long-running process detached from ours (the emulator). */
export type Spawn = (file: string, args: readonly string[]) => void;

export const spawnDetached: Spawn = (file, args) => {
  const child = spawn(file, args, { detached: true, stdio: 'ignore' });
  child.unref();
};

/** Single-quote for the device-side `sh` (`adb shell` joins its arguments into one shell command). */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
