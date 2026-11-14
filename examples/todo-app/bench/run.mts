/**
 * Performance benchmark (requirements.md §8 性能): soft reset, one tap including sync, full suite.
 * Prints a Markdown section for docs/benchmarks.mdx.
 *
 *   QUIESCO_PLATFORM=android node bench/run.mts [iterations=20] [-- cucumber-js args]
 *
 * The suite is timed in both action modes, so pass a subset that runs in `js` mode too (scenarios that need
 * real touches cannot), e.g. `-- --name '^(登录后看到自己的待办列表|…)$'` for the Phase 2 baseline.
 *
 * Needs Metro in e2e mode (`pnpm start:e2e`) and a running emulator, like the e2e tests.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';

import { Session, loadConfig, resolvePlatform, silentLogger } from '@quiesco/core';
import type { ActionMode, QuiescoConfig } from '@quiesco/core';

import { startMockServer } from '../mock-server/server.mjs';

const iterations = Number(process.argv[2] ?? 20);
const platform = resolvePlatform();

interface Stats {
  median: number;
  p90: number;
  min: number;
  max: number;
}

function stats(xs: number[]): Stats {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))] as number;
  return { median: at(0.5), p90: at(0.9), min: s[0] as number, max: s[s.length - 1] as number };
}

const fmt = (st: Stats): string => `${st.median} | ${st.p90} | ${st.min} | ${st.max}`;

async function measure(mode: ActionMode, base: QuiescoConfig): Promise<Record<string, Stats>> {
  const session = await Session.create({ config: { ...base, actions: { mode } }, platform, logger: silentLogger });
  const app = session.driver;
  const resetAgent: number[] = [];
  const resetWall: number[] = [];
  const tap: number[] = [];
  try {
    for (let i = 0; i < iterations + 1; i++) {
      let t = performance.now();
      const agentMs = await app.reset();
      const wall = performance.now() - t;
      await app.expectVisible('login-button');
      t = performance.now();
      await app.tap('login-button'); // empty email: shows a hint, no network
      const tapMs = performance.now() - t;
      await app.expectVisible('login-error');
      if (i === 0) continue; // warm-up
      resetAgent.push(agentMs);
      resetWall.push(Math.round(wall));
      tap.push(Math.round(tapMs));
    }
  } finally {
    await session.dispose();
  }
  return { 'soft reset (agent)': stats(resetAgent), 'soft reset (host round trip)': stats(resetWall), 'tap incl. sync (host round trip)': stats(tap) };
}

const dashes = process.argv.indexOf('--');
const extra = dashes === -1 ? [] : process.argv.slice(dashes + 1);

function suite(mode: ActionMode): number {
  const t = performance.now();
  const r = spawnSync('npx', ['cucumber-js', '--format', 'summary', ...extra], {
    env: { ...process.env, QUIESCO_PLATFORM: platform, ...(mode === 'js' ? { QUIESCO_ACTION_MODE: 'js' } : {}) },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`suite failed in ${mode} mode:\n${r.stdout}\n${r.stderr}`);
  return Math.round((performance.now() - t) / 100) / 10;
}

function adb(args: string[]): string {
  try {
    return execFileSync('adb', args, { encoding: 'utf8' }).trim();
  } catch {
    return '?';
  }
}

const { config } = await loadConfig();
const mock = await startMockServer();
const results: Record<string, Record<string, Stats>> = {};
const suiteSeconds: Record<string, number> = {};
try {
  for (const mode of ['native', 'js'] as const) results[mode] = await measure(mode, config);
} finally {
  await mock.close();
}
for (const mode of ['native', 'js'] as const) suiteSeconds[mode] = suite(mode);

const device = platform === 'android' ? `${adb(['shell', 'getprop', 'ro.boot.qemu.avd_name'])} (Android ${adb(['shell', 'getprop', 'ro.build.version.release'])}, API ${adb(['shell', 'getprop', 'ro.build.version.sdk'])})` : platform;
const lines = [
  `### ${new Date().toISOString().slice(0, 10)} — ${platform}, ${iterations} iterations`,
  '',
  `- Device: ${device}; dev client, Metro (dev JS bundle)`,
  `- Host: ${os.cpus()[0]?.model ?? os.arch()}, ${os.platform()} ${os.release()}, Node ${process.version}`,
  '',
  '| Metric (ms) | Mode | Median | p90 | Min | Max |',
  '|---|---|---|---|---|---|',
  ...Object.entries(results).flatMap(([mode, r]) => Object.entries(r).map(([metric, st]) => `| ${metric} | ${mode} | ${fmt(st)} |`)),
  '',
  '| Full example suite (s, incl. install + launch) | native | js |',
  '|---|---|---|',
  `| \`cucumber-js\` | ${suiteSeconds['native']} | ${suiteSeconds['js']} |`,
];
console.log(lines.join('\n'));
