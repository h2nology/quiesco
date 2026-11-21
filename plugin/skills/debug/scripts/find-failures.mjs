#!/usr/bin/env node
/**
 * Summarize the failed scenarios of a Quiesco run from its artifacts directory.
 *
 *   node find-failures.mjs [artifactsDir] [--run <run-dir-name>] [--list-runs]
 *
 * artifactsDir defaults to ./artifacts (Quiesco's default `artifacts.dir`). Without --run the latest run
 * is used: run directories are named <yyyymmdd>-<hhmmss>-<platform>, so the latest sorts last. A parallel
 * run has one directory per worker (<...>-<platform>-wN); they are read together as one run.
 *
 * For every scenario directory with failure evidence (failure.png / idle-state.json) it prints the
 * directory, its files with sizes, the failed call and its error (from timeline.trace.json) and the
 * busy trackers (from idle-state.json). Exit code 0 also when nothing failed; 1 on a usage problem.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) {
    console.error(`${name} needs a value. Usage: node find-failures.mjs [artifactsDir] [--run <run-dir-name>] [--list-runs]`);
    process.exit(1);
  }
  args.splice(i, 2);
  return v;
};
const listRuns = args.includes('--list-runs');
if (listRuns) args.splice(args.indexOf('--list-runs'), 1);
const runName = flag('--run');
const dir = path.resolve(args[0] ?? 'artifacts');

if (!fs.existsSync(dir)) {
  console.error(`No artifacts directory at ${dir}. Pass the path of artifacts.dir from quiesco.config.* if it was changed.`);
  process.exit(1);
}

// A run is <yyyymmdd>-<hhmmss>-<platform>; a parallel run has one directory per worker (`-wN`).
const RUN = /^(\d{8}-\d{6}-(?:ios|android|web))(?:-w(\d+))?$/;
/** run name -> its directories (one, or one per worker) */
const runDirs = new Map();
for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
  const m = d.isDirectory() && RUN.exec(d.name);
  if (!m) continue;
  if (!runDirs.has(m[1])) runDirs.set(m[1], []);
  runDirs.get(m[1]).push(d.name);
}
for (const dirs of runDirs.values()) dirs.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const runs = [...runDirs.keys()].sort();
const workersOf = (r) => (runDirs.get(r).length > 1 || runDirs.get(r)[0] !== r ? ` (${runDirs.get(r).length} workers)` : '');

if (listRuns) {
  for (const r of runs) console.log(`${r}${workersOf(r)}`);
  process.exit(0);
}
if (runs.length === 0) {
  console.error(`No runs in ${dir} (expected directories like 20261115-214332-ios or 20261115-214332-ios-w0).`);
  process.exit(1);
}
const run = (runName && RUN.exec(runName)?.[1]) ?? runName ?? runs[runs.length - 1];
if (!runDirs.has(run)) {
  console.error(`No run ${run} in ${dir}. Recent runs: ${runs.slice(-5).join(', ')}`);
  process.exit(1);
}

/** A scenario failed when Quiesco wrote failure evidence for it. */
const isFailed = (scenarioDir) => ['failure.png', 'idle-state.json'].some((f) => fs.existsSync(path.join(scenarioDir, f)));
/** Every scenario directory of a run, across its workers. */
const scenarioDirs = (r) =>
  runDirs.get(r).flatMap((w) =>
    fs
      .readdirSync(path.join(dir, w), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, w, d.name))
      .sort(),
  );

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};
const size = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

const scenarios = scenarioDirs(run);
const failed = scenarios.filter(isFailed);

console.log(`Run: ${run}${workersOf(run)}   Directories: ${runDirs.get(run).map((w) => path.join(dir, w)).join(', ')}`);
console.log(`Platform: ${run.split('-')[2]}   Scenarios with artifacts: ${scenarios.length}   Failed: ${failed.length}`);
if (failed.length === 0) {
  const withFailures = runs.filter((r) => r !== run && scenarioDirs(r).some(isFailed)).slice(-5).reverse();
  console.log(withFailures.length ? `No failures in this run. Recent runs with failures (use --run): ${withFailures.join(', ')}` : 'No failures in this run.');
}

for (const sdir of failed) {
  console.log(`\n## ${path.basename(sdir)}`);
  console.log(`Dir: ${sdir}`);
  const files = fs.readdirSync(sdir).sort();
  console.log(`Files: ${files.map((f) => `${f} (${size(fs.statSync(path.join(sdir, f)).size)})`).join(', ')}`);

  const trace = readJson(path.join(sdir, 'timeline.trace.json'));
  const calls = (trace?.traceEvents ?? []).filter((e) => e.ph === 'X' && e.cat !== 'sync');
  const firstFailed = calls.findIndex((e) => e.args?.error);
  if (firstFailed !== -1) {
    for (const e of calls.filter((c) => c.args?.error)) {
      console.log(`Failed call: ${e.name}${typeof e.dur === 'number' ? ` (${Math.round(e.dur / 1000)} ms)` : ''}`);
      console.log(`Error: ${String(e.args.error).trim()}`);
    }
    const before = calls.slice(Math.max(0, firstFailed - 5), firstFailed).map((e) => e.name);
    console.log(`Calls before it: ${before.length ? before.join(' → ') : '(none)'}`);
  } else {
    console.log('Failed call: not recorded (timeline off, or the failure was outside a Quiesco call — e.g. a plain assert or a step error). Read the runner output.');
  }

  const idle = readJson(path.join(sdir, 'idle-state.json'));
  const busy = (idle?.idleState ?? []).filter((t) => !t.idle);
  if (busy.length) {
    for (const t of busy) console.log(`Busy: ${t.name}: ${JSON.stringify(t.busy)}`);
  } else if (idle) {
    console.log('Busy: nothing (the app was idle when the evidence was taken)');
  }
  // frame-stable only samples while a call waits: what it saw when the last wait ended busy.
  for (const t of idle?.idleState ?? []) {
    if (Array.isArray(t.lastWait) && t.lastWait.length) console.log(`Busy at the end of the last wait: ${t.name}: ${JSON.stringify(t.lastWait)}`);
  }
}
