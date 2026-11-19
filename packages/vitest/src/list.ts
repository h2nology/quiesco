/**
 * `node …/@quiesco/vitest/dist/list-main.js --out <file> [--config <file>] [filters…]`: lists the tests
 * Vitest would run, without running them (`quiesco list`, the UI's test tree). Run in the project
 * directory. Writes a TestList (JSON) to `--out`.
 *
 * A static parse (`parseSpecifications`): no globalSetup, setup files, module code or fixtures run
 * (findings P0). `test.each` is listed once; skipped and todo tests are listed too. Ids are Vitest's own
 * test ids, as the reporter sends them. The static parse takes every `test.<x>(…)` call for a test, so
 * hook calls through the test function (`test.beforeEach(reset)`, #55) are dropped by their source.
 */
import fs from 'node:fs';

import type { TestList, TestRef } from '@quiesco/core';
import { createVitest } from 'vitest/node';

import { testRef } from './reporter.js';

export interface ListArgs {
  out: string;
  config?: string;
  filters: string[];
}

export function parseListArgs(argv: readonly string[]): ListArgs {
  const args: ListArgs = { out: '', filters: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--out') args.out = argv[++i] ?? '';
    else if (a === '--config' || a === '-c') args.config = argv[++i] ?? '';
    else if (a.startsWith('--config=')) args.config = a.slice('--config='.length);
    else if (!a.startsWith('-')) args.filters.push(a);
  }
  return args;
}

export async function listVitestTests(args: Omit<ListArgs, 'out'>): Promise<TestList> {
  const vitest = await createVitest({ ...(args.config !== undefined ? { config: args.config } : {}), watch: false, reporters: [] });
  try {
    const root = vitest.config.root;
    const specifications = await vitest.globTestSpecifications(args.filters);
    const modules = await vitest.parseSpecifications(specifications);
    const tests: TestRef[] = [];
    const errors: { file?: string; message: string }[] = [];
    for (const m of modules) {
      const lines = sourceLines(m.moduleId);
      for (const t of m.children.allTests()) if (!isHookCall(lines, t.location)) tests.push(testRef(t, root));
      for (const e of m.errors()) errors.push({ file: testRefFile(root, m.moduleId), message: e.message });
    }
    return { runner: 'vitest', files: specifications.map((s) => testRefFile(root, s.moduleId)), tests, errors };
  } finally {
    await vitest.close();
  }
}

/** Hooks a test function also has (`test.beforeEach`, `it.afterAll`, …): calls of these are not tests. */
const HOOK_CALL = /^[\w$]+(?:\.[\w$]+)*\.(?:beforeEach|afterEach|beforeAll|afterAll|aroundEach|aroundAll|onTestFailed|onTestFinished)\s*\(/;

function sourceLines(file: string): string[] | null {
  try {
    return fs.readFileSync(file, 'utf8').split('\n');
  } catch {
    return null;
  }
}

/** Whether the call at `location` (1-based line and column, in the original source) is a hook call. */
export function isHookCall(lines: readonly string[] | null, location: { line: number; column: number } | undefined): boolean {
  if (lines === null || location === undefined) return false;
  const line = lines[location.line - 1];
  return line !== undefined && HOOK_CALL.test(line.slice(location.column - 1));
}

function testRefFile(root: string, file: string): string {
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
}

export async function listMain(argv: readonly string[]): Promise<void> {
  const args = parseListArgs(argv);
  let list: TestList;
  try {
    list = await listVitestTests(args);
  } catch (e) {
    list = { runner: 'vitest', files: [], tests: [], errors: [{ message: (e as Error).message }] };
  }
  const json = JSON.stringify(list);
  if (args.out === '') process.stdout.write(`${json}\n`);
  else fs.writeFileSync(args.out, json);
}
