/**
 * `node …/@quiesco/cucumber/dist/list-main.js --out <file> [--config <file>] [--profile <name>] [paths…]`:
 * lists the scenarios cucumber-js would run, without running them (`quiesco list`, the UI's test tree).
 * Run in the project directory. Writes a TestList (JSON) to `--out`.
 *
 * A dry run through cucumber's API with the formats and plugins taken out: `cucumber-js --dry-run`
 * would also run the configured formats and overwrite their report files (findings P0). Support files
 * are loaded (their top-level code runs; hooks and steps do not).
 */
import fs from 'node:fs';
import { Writable } from 'node:stream';

import { loadConfiguration, runCucumber } from '@cucumber/cucumber/api';
import type { TestList, TestRef } from '@quiesco/core';

import { DocumentIndex } from './run-events.js';
import type { EnvelopeLike, PickleLike } from './run-events.js';

export interface ListArgs {
  out: string;
  config?: string;
  profiles: string[];
  paths: string[];
}

export function parseListArgs(argv: readonly string[]): ListArgs {
  const args: ListArgs = { out: '', profiles: [], paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const value = () => argv[++i] ?? '';
    if (a === '--out') args.out = value();
    else if (a === '--config' || a === '-c') args.config = value();
    else if (a === '--profile' || a === '-p') args.profiles.push(value());
    else if (!a.startsWith('-')) args.paths.push(a);
  }
  return args;
}

const sink = () => new Writable({ write: (_c, _e, cb) => cb() });

export async function listScenarios(cwd: string, args: Omit<ListArgs, 'out'>): Promise<TestList> {
  const { runConfiguration } = await loadConfiguration(
    { ...(args.config !== undefined ? { file: args.config } : {}), profiles: args.profiles, provided: args.paths.length > 0 ? { paths: args.paths } : {} },
    { cwd, stdout: sink(), stderr: sink() },
  );
  const docs = new DocumentIndex();
  const pickles = new Map<string, PickleLike>();
  const planned: string[] = [];
  await runCucumber(
    {
      ...runConfiguration,
      runtime: { ...runConfiguration.runtime, dryRun: true, parallel: 0 },
      formats: { stdout: 'summary', files: {}, publish: false, options: {} },
      plugins: { specifiers: [], options: {} },
    },
    { cwd, stdout: sink(), stderr: sink() },
    (envelope) => {
      const e = envelope as EnvelopeLike;
      if (e.gherkinDocument !== undefined) docs.add(e.gherkinDocument);
      else if (e.pickle !== undefined) pickles.set(e.pickle.id, e.pickle);
      else if (e.testCase !== undefined) planned.push(e.testCase.pickleId);
    },
  );
  const tests: TestRef[] = planned.flatMap((id) => {
    const p = pickles.get(id);
    return p !== undefined ? [docs.ref(p)] : [];
  });
  return { runner: 'cucumber', files: [...new Set(tests.map((t) => t.file))], tests, errors: [] };
}

/** The `list-main.js` entry: list, write the TestList to `--out` (stdout without it). */
export async function listMain(argv: readonly string[]): Promise<void> {
  const args = parseListArgs(argv);
  let list: TestList;
  try {
    list = await listScenarios(process.cwd(), args);
  } catch (e) {
    list = { runner: 'cucumber', files: [], tests: [], errors: [{ message: (e as Error).message }] };
  }
  const json = JSON.stringify(list);
  if (args.out === '') process.stdout.write(`${json}\n`);
  else fs.writeFileSync(args.out, json);
}
