/**
 * The test tree the page shows: the listed tests merged with what runs reported, filtered, searched and
 * sorted. Pure functions of the connection data.
 */
import type { TestState } from '@quiesco/core/run-state';
import type { RunError, RunnerName, TestRef, TestStatus } from '@quiesco/protocol';

import type { RunTarget, RunningInfo } from '../../src/messages';
import type { UiData } from './connection';

export type RowStatus = TestStatus | 'running' | 'queued' | 'idle';
export type Filter = 'all' | 'failed' | 'passed' | 'skipped' | 'running';
export type Sort = 'default' | 'failed' | 'slowest';

export interface TestItem {
  ref: TestRef;
  status: RowStatus;
  state: TestState | undefined;
  /** Group titles above the test (describe / rule), for display. */
  groups: string;
}

export interface FileItem {
  file: string;
  tests: TestItem[];
  failed: number;
  done: number;
  total: number;
  error: RunError | undefined;
}

export function inTarget(target: RunTarget, ref: TestRef): boolean {
  if (target.kind === 'all') return true;
  if (target.kind === 'file') return ref.file === target.file;
  return target.ids.includes(ref.id);
}

const FINISHED: ReadonlySet<RowStatus> = new Set(['passed', 'failed', 'skipped', 'todo', 'pending', 'undefined']);
export const isFinished = (s: RowStatus) => FINISHED.has(s);
export const isSkippedLike = (s: RowStatus) => s === 'skipped' || s === 'todo' || s === 'pending' || s === 'undefined' || s === 'notRun';

function statusOf(ref: TestRef, st: TestState | undefined, running: RunningInfo | null, touched: ReadonlySet<string>): RowStatus {
  if (running !== null && inTarget(running.target, ref) && !touched.has(ref.id)) return 'queued';
  return st?.status ?? 'idle';
}

function groupsOf(ref: TestRef, runner: RunnerName | undefined): string {
  const parents = ref.path.slice(0, -1);
  // cucumber: the feature's title is the file's; show rules only.
  return (runner === 'cucumber' ? parents.slice(1) : parents).join(' › ');
}

/** All known tests, in list order, then tests only runs reported (Vitest's test.each rows). */
export function allTests(data: Pick<UiData, 'list' | 'state' | 'info'>): TestRef[] {
  const out = new Map<string, TestRef>();
  const reported = [...data.state.tests.values()].map((t) => t.test);
  // A listed test.each entry (one id for all rows) gives way to the rows a run reported on its line.
  const reportedAt = new Set(reported.map((t) => `${t.file}:${t.line ?? ''}`));
  for (const t of data.list?.tests ?? []) {
    const replaced = !data.state.tests.has(t.id) && t.line !== undefined && reportedAt.has(`${t.file}:${t.line}`);
    if (!replaced) out.set(t.id, t);
  }
  for (const t of reported) out.set(t.id, { ...out.get(t.id), ...t });
  return [...out.values()];
}

export function buildTree(data: UiData, filter: Filter, query: string, sort: Sort): FileItem[] {
  const q = query.trim().toLowerCase();
  const byFile = new Map<string, FileItem>();
  const fileOrder = [...(data.list?.files ?? [])];
  for (const ref of allTests(data)) {
    const st = data.state.tests.get(ref.id);
    const status = statusOf(ref, st, data.running, data.touched);
    let f = byFile.get(ref.file);
    if (f === undefined) {
      f = { file: ref.file, tests: [], failed: 0, done: 0, total: 0, error: data.state.fileErrors.get(ref.file) };
      byFile.set(ref.file, f);
      if (!fileOrder.includes(ref.file)) fileOrder.push(ref.file);
    }
    f.total++;
    if (status === 'failed') f.failed++;
    if (isFinished(status)) f.done++;
    const keep =
      (filter === 'all' || (filter === 'failed' && status === 'failed') || (filter === 'passed' && status === 'passed') || (filter === 'skipped' && isSkippedLike(status)) || (filter === 'running' && (status === 'running' || status === 'queued'))) &&
      (q === '' || `${ref.path.join(' ')} ${ref.file}`.toLowerCase().includes(q));
    if (keep) f.tests.push({ ref, status, state: st, groups: groupsOf(ref, data.info?.runner) });
  }
  for (const [file, error] of data.state.fileErrors) if (!byFile.has(file)) byFile.set(file, { file, tests: [], failed: 0, done: 0, total: 0, error });
  for (const e of data.list?.errors ?? []) if (e.file !== undefined && !byFile.has(e.file)) byFile.set(e.file, { file: e.file, tests: [], failed: 0, done: 0, total: 0, error: { message: e.message } });

  const files = fileOrder.concat([...byFile.keys()].filter((f) => !fileOrder.includes(f))).flatMap((name) => {
    const f = byFile.get(name);
    if (f === undefined) return [];
    if (f.tests.length === 0 && (f.error === undefined || filter !== 'all' || q !== '')) return [];
    return [f];
  });
  if (sort !== 'default') {
    const rank = (t: TestItem) => (sort === 'failed' ? (t.status === 'failed' ? 0 : 1) : -(t.state?.durationMs ?? -1));
    for (const f of files) f.tests.sort((a, b) => rank(a) - rank(b));
    if (sort === 'failed') files.sort((a, b) => (b.failed > 0 ? 1 : 0) - (a.failed > 0 ? 1 : 0));
  }
  return files;
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

export const STATUS_LABEL: Record<RowStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  skipped: 'Skipped',
  todo: 'Todo',
  pending: 'Pending',
  undefined: 'Undefined step',
  notRun: 'Not run',
  running: 'Running',
  queued: 'Queued',
  idle: 'Not run yet',
};
