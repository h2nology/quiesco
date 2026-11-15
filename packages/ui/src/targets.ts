/**
 * What to run, as runner arguments (findings P0): the UI asks for all tests, one file, or some tests;
 * each runner selects them its own way.
 *
 * - cucumber: `file:line[:line…]` (a Scenario line, or an Examples row's line). NOTE: cucumber-js adds
 *   command line paths to the `paths` of its config instead of replacing them, so a config with `paths`
 *   runs more than asked (Quiesco's init no longer writes `paths`).
 * - vitest: `file:line` (a `test.each` line runs every row).
 * - jest: `--runTestsByPath <files>` and `-t '^(full name|…)$'` (titles joined with spaces; Jest matches
 *   case-insensitively, so a test with the same name in another chosen file runs too).
 */
import type { RunnerName, TestRef } from '@quiesco/protocol';

export type RunTarget = { kind: 'all' } | { kind: 'file'; file: string } | { kind: 'tests'; ids: readonly string[] };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Runner arguments selecting `target`; `tests` resolves test ids to their file and line. */
export function targetArgs(runner: RunnerName, target: RunTarget, tests: ReadonlyMap<string, TestRef>): string[] {
  if (target.kind === 'all') return [];
  if (target.kind === 'file') return runner === 'jest' ? ['--runTestsByPath', target.file] : [target.file];

  const refs = target.ids.flatMap((id) => {
    const t = tests.get(id);
    return t !== undefined ? [t] : [];
  });
  if (refs.length === 0) throw new Error('none of the chosen tests is known (list the tests again)');
  const byFile = new Map<string, TestRef[]>();
  for (const t of refs) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t]);

  if (runner === 'jest') {
    const names = [...new Set(refs.map((t) => escapeRegExp(t.path.join(' '))))];
    return ['--runTestsByPath', ...byFile.keys(), '-t', `^(${names.join('|')})$`];
  }
  const out: string[] = [];
  for (const [file, ts] of byFile) {
    const lines = [...new Set(ts.flatMap((t) => (t.line !== undefined ? [t.line] : [])))].sort((a, b) => a - b);
    if (lines.length === 0 || lines.length < ts.length) {
      out.push(file); // a test without a line: the whole file
    } else if (runner === 'cucumber') {
      out.push(`${file}:${lines.join(':')}`);
    } else {
      for (const l of lines) out.push(`${file}:${l}`);
    }
  }
  return out;
}
