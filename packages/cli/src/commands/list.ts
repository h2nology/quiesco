/**
 * `quiesco list [--runner cucumber|jest|vitest] [--json] [runner arguments…]` (P4): the tests the runner
 * would run, without running them or starting a device. Grouped by file; `--json` prints the TestList
 * (the ids the run events use). Runner arguments: `--config <file>`, paths / filters (cucumber also
 * `--profile`).
 */
import type { TestList } from '@quiesco/core';
import { listTests } from '@quiesco/core';

import type { CliContext } from '../context.js';
import { takeFlag, takeOption } from '../context.js';

export const LIST_HELP = `Usage: quiesco list [options] [runner arguments…]

Lists the tests the runner would run, without running them (no device is started).

Options:
  --runner cucumber|jest|vitest  Test runner (default: cucumber)
  --json                         Print the list as JSON (ids as in the run events)
  -h, --help                     Show this help

Runner arguments: --config <file>, paths or filters (cucumber: also --profile <name>).

Examples:
  quiesco list
  quiesco list features/login.feature
  quiesco list --runner vitest --config vitest.e2e.config.mts`;

export interface ListDeps {
  listTests: typeof listTests;
}

const RUNNERS = ['cucumber', 'jest', 'vitest'] as const;

export function formatList(list: TestList): string[] {
  const lines: string[] = [];
  const byFile = new Map<string, TestList['tests'][number][]>();
  for (const f of list.files) byFile.set(f, []);
  for (const t of list.tests) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t]);
  for (const [file, tests] of byFile) {
    lines.push(file);
    for (const t of tests) lines.push(`  ${t.path.join(' › ')}${t.line !== undefined ? `  :${t.line}` : ''}`);
  }
  for (const e of list.errors) lines.push(`✗ ${e.file !== undefined ? `${e.file}: ` : ''}${e.message}`);
  lines.push(`${list.tests.length} test${list.tests.length === 1 ? '' : 's'} in ${list.files.length} file${list.files.length === 1 ? '' : 's'}`);
  return lines;
}

export async function listCommand(args: readonly string[], ctx: CliContext, deps: ListDeps = { listTests }): Promise<number> {
  if (args.includes('-h') || args.includes('--help')) {
    ctx.out(LIST_HELP);
    return 0;
  }
  const r = takeOption(args, '--runner');
  const json = takeFlag(r.rest, '--json');
  const runner = r.value ?? 'cucumber';
  if (!(RUNNERS as readonly string[]).includes(runner)) {
    ctx.err(`quiesco list: unknown runner "${runner}" (cucumber, jest or vitest).`);
    return 2;
  }
  const list = await deps.listTests({ runner: runner as (typeof RUNNERS)[number], cwd: ctx.cwd, args: json.rest, env: ctx.env });
  if (json.present) ctx.out(JSON.stringify(list, null, 2));
  else for (const line of formatList(list)) ctx.out(line);
  return list.errors.length > 0 && list.tests.length === 0 ? 1 : 0;
}
