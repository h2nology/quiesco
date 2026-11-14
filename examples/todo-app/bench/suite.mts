/**
 * Suite timing (requirements.md §8 稳定性 / task 4.8): runs the whole example suite N times in a row and
 * prints a Markdown section for docs/benchmarks.mdx (pass count and wall time per run).
 *
 *   node bench/suite.mts --platform ios --runs 20
 *   node bench/suite.mts --platform android --runs 5
 *   node bench/suite.mts --platform web --runs 5 -- --name '^(登录后|新建的待办)'   (the rest goes to cucumber-js)
 *
 * Needs the same setup as the e2e tests (Metro in e2e mode for native, devices running or bootable).
 * Wall time is measured around `cucumber-js`, so it includes install, launch and session setup.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';

interface Run {
  ok: boolean;
  scenarios: string;
  seconds: number;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const platform = arg('platform');
if (platform !== 'web' && platform !== 'android' && platform !== 'ios') {
  console.error('usage: node bench/suite.mts --platform web|android|ios [--runs 5]');
  process.exit(2);
}
const runs = Number(arg('runs', '5'));
// Arguments after `--` are passed to cucumber-js (e.g. `--name` to time a subset comparable with an older run).
const dashes = process.argv.indexOf('--');
const extra = dashes === -1 ? [] : process.argv.slice(dashes + 1);

const results: Run[] = [];
for (let i = 1; i <= runs; i++) {
  const args = ['cucumber-js', '--format', 'summary', ...extra];
  const started = performance.now();
  const r = spawnSync('npx', args, { env: { ...process.env, QUIESCO_PLATFORM: platform }, encoding: 'utf8' });
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  const out = `${r.stdout}\n${r.stderr}`;
  const scenarios = /(\d+ scenarios? \([^)]*\))/.exec(out)?.[1] ?? 'no summary';
  const run = { ok: r.status === 0, scenarios, seconds };
  results.push(run);
  console.error(`[suite] ${platform} run ${i}/${runs}: ${run.ok ? 'passed' : 'FAILED'} — ${scenarios}, ${seconds}s`);
  if (!run.ok) console.error(out.split('\n').slice(-40).join('\n'));
}

const times = results.map((r) => r.seconds).sort((a, b) => a - b);
const median = times.length % 2 === 1 ? times[(times.length - 1) / 2] : ((times[times.length / 2 - 1] ?? 0) + (times[times.length / 2] ?? 0)) / 2;
const passed = results.filter((r) => r.ok).length;

console.log(
  [
    `#### ${new Date().toISOString().slice(0, 10)} — ${platform}, ${runs} runs`,
    '',
    `- Host: ${os.cpus()[0]?.model ?? os.arch()}, ${os.platform()} ${os.release()}, Node ${process.version}`,
    '',
    '| Runs | Passed | Wall time per run (s) |',
    '|---|---|---|',
    `| ${runs} | ${passed} / ${runs} | min ${times[0]}, median ${Math.round((median ?? 0) * 10) / 10}, max ${times[times.length - 1]} |`,
    '',
    `Per run (s): ${results.map((r) => `${r.seconds}${r.ok ? '' : ' ✗'}`).join(', ')}.`,
    '',
  ].join('\n'),
);
process.exit(passed === runs ? 0 : 1);
