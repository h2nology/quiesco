/**
 * List the tests a runner would run, without running them (`quiesco list`, the UI's test tree): runs
 * the project's own `@quiesco/<runner>/list` in a child process (it loads the project's runner) and
 * reads back the TestList it writes.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { RunnerName, TestList } from '@quiesco/protocol';

export interface ListTestsOptions {
  runner: RunnerName;
  /** The project directory. */
  cwd: string;
  /** Runner arguments: `--config <file>`, paths / filters (cucumber also `--profile`). */
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

/** Where the project's @quiesco/<runner>/list is; null when that adapter is not installed. */
export function listEntry(runner: RunnerName, cwd: string): string | null {
  try {
    return createRequire(path.join(cwd, 'package.json')).resolve(`@quiesco/${runner}/list`);
  } catch {
    return null;
  }
}

export async function listTests(options: ListTestsOptions): Promise<TestList> {
  const { runner, cwd } = options;
  const entry = listEntry(runner, cwd);
  if (entry === null) return { runner, files: [], tests: [], errors: [{ message: `@quiesco/${runner} is not installed in ${cwd} (or is older than 0.3.0)` }] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-list-'));
  const out = path.join(dir, 'list.json');
  let stderr = '';
  try {
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [entry, '--out', out, ...(options.args ?? [])], { cwd, env: options.env ?? process.env, stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      child.on('error', () => resolve(127));
      child.on('close', resolve);
    });
    try {
      return JSON.parse(fs.readFileSync(out, 'utf8')) as TestList;
    } catch {
      const tail = stderr.trim().split('\n').slice(-5).join('\n');
      return { runner, files: [], tests: [], errors: [{ message: `listing the ${runner} tests failed (exit ${code})${tail !== '' ? `:\n${tail}` : ''}` }] };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
