/**
 * `node …/@quiesco/jest/dist/list-main.js --out <file> [jest arguments]`: lists the tests Jest would
 * run, without running them (`quiesco list`, the UI's test tree). Run in the project directory.
 *
 * Jest cannot list test names, so this is a collect-only run (findings P0): a name pattern that matches
 * nothing (every test is skipped, no hook or test runs), the list reporter instead of the configured
 * ones, no-op globalSetup / globalTeardown (the project's may start servers), and QUIESCO_LIST=1 so
 * Quiesco's test environment does not start a device. Setup files still run.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TestList } from '@quiesco/core';

const here = path.dirname(fileURLToPath(import.meta.url));

export function listArgs(argv: readonly string[]): { out: string; rest: string[] } {
  const rest: string[] = [];
  let out = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i] ?? '';
    else rest.push(argv[i] as string);
  }
  return { out, rest };
}

/** The jest arguments of a collect-only run (`rest` first: `--reporters` would swallow paths after it). */
export function collectOnlyArgs(rest: readonly string[]): string[] {
  return [
    ...rest,
    '--testNamePattern',
    '(?!)',
    '--testLocationInResults',
    '--globalSetup',
    path.join(here, 'noop-global.js'),
    '--globalTeardown',
    path.join(here, 'noop-global.js'),
    '--reporters',
    path.join(here, 'list-reporter.js'),
  ];
}

export async function listJestTests(cwd: string, rest: readonly string[]): Promise<TestList> {
  const jestBin = path.join(path.dirname(createRequire(path.join(cwd, 'package.json')).resolve('jest/package.json')), 'bin', 'jest.js');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-list-')), 'list.json');
  let stderr = '';
  const code = await new Promise<number | null>((resolve) => {
    const child = spawn(process.execPath, [jestBin, ...collectOnlyArgs(rest)], { cwd, env: { ...process.env, QUIESCO_LIST: '1', QUIESCO_LIST_OUT: out, CI: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('close', resolve);
  });
  try {
    return JSON.parse(fs.readFileSync(out, 'utf8')) as TestList;
  } catch {
    return { runner: 'jest', files: [], tests: [], errors: [{ message: `jest exited with ${code}: ${stderr.trim().split('\n').slice(-5).join('\n')}` }] };
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
}

export async function listMain(argv: readonly string[]): Promise<void> {
  const { out, rest } = listArgs(argv);
  const list = await listJestTests(process.cwd(), rest);
  const json = JSON.stringify(list);
  if (out === '') process.stdout.write(`${json}\n`);
  else fs.writeFileSync(out, json);
}
