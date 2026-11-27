// Turns a shootout summary (speed-test-results/<quiesco version>.json, the rn-e2e-shootout summary.json)
// into assets/benchmark-data.js.
// Usage: node site/build-data.mjs [path/to/summary.json]   (default: the newest file in speed-test-results/)
//
// Quiesco is shown at the newest version in the summary; an older Quiesco version, if any, is kept as
// `quiesco.previous` for the page's "re-measured" note. Per-scenario times are scenarioMs (reset start →
// scenario end, METHODOLOGY v20): the resetMs / durationMs split differs by tool, so it isn't compared.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = resolve(here, '../speed-test-results');
const semver = (v) => v.split('.').map(Number);
const newer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
const newest = () => {
  const files = readdirSync(resultsDir).filter((f) => /^\d+\.\d+\.\d+\.json$/.test(f));
  return resolve(resultsDir, files.reduce((a, f) => (a == null || newer(f.slice(0, -5), a.slice(0, -5)) ? f : a), null));
};
const src = resolve(process.argv[2] ?? newest());
const summary = JSON.parse(readFileSync(src, 'utf8'));

// What the summary doesn't carry: sessions, dates and the methodology exception (rn-e2e-shootout METHODOLOGY 2.1 / 2.2).
const META = {
  sessions: { others: 'm5-final-none', quiesco: 'm5-quiesco-0144' },
  measured: { others: '2026-11-24 → 2026-11-26', quiesco: '2026-11-27' },
  methodology: 'v21',
};

const NAMES = {
  S1: 'Log in and land on the list',
  S2: 'Validation message for an invalid email',
  S3: 'Debounced search',
  S4: 'Add an item that survives a refresh',
  S5: 'Delete an item through a confirm modal',
  S6: 'Scroll a long list to row 400',
  S7a: 'Chinese / Japanese input (text API)',
  S8: 'Native controls',
  S9: 'WebView',
  S10a: 'System permission (pre-granted)',
  S10b: 'System permission (tap the system dialog)',
  S11: 'An animation that never settles',
  S12: 'Swipe to delete',
  S13: 'Pull to refresh',
  S14: 'Long-press menu and drag to reorder',
  S15: 'Reanimated animation',
  S16: 'Polling and WebSocket',
  S17: 'Auto-dismissing toast',
  S18: 'Error state and retry',
  S19: 'Tabs and nested navigation',
  S20: 'Keyboard covering the input',
  S21: 'Deep link',
  S22: 'Local notification',
  S23: 'Background, foreground and persistence',
};
const TOOLS = ['quiesco', 'detox', 'appium', 'maestro'];
const PLATS = ['ios', 'android'];
const sec = (ms) => (ms == null ? null : Math.round(ms / 100) / 10);
const pct = (x) => Math.round(x * 1000) / 10;

// One group per tool and platform; Quiesco at its newest version.
const groups = summary.groups.filter((g) => g.variant === 'final' && g.stress === 'none');
const qVersions = [...new Set(groups.filter((g) => g.tool === 'quiesco').map((g) => g.toolVersion))].sort((a, b) => (newer(a, b) ? -1 : 1));
const pick = (tool, plat, version) => {
  const g = groups.find((x) => x.tool === tool && x.platform === plat && (tool !== 'quiesco' || x.toolVersion === version));
  if (!g) throw new Error(`no group for ${tool} ${plat} ${version ?? ''}`);
  return g;
};

const suite = {};
const shared = {};
const scenarios = Object.keys(NAMES).map((id) => ({ id, name: NAMES[id], ios: {}, android: {}, errors: { ios: [], android: [] } }));
for (const p of PLATS) {
  for (const tool of TOOLS) {
    const g = pick(tool, p, qVersions[0]);
    const s = g.suite;
    (suite[p] ??= {})[tool] = {
      median: sec(s.commonSuiteMs.median), p90: sec(s.commonSuiteMs.p90), min: sec(s.commonSuiteMs.min), max: sec(s.commonSuiteMs.max),
      failures: s.failures, runs: g.runs, failRate: pct(s.failureRate.rate), ci: [pct(s.failureRate.low), pct(s.failureRate.high)],
      install: sec(s.installMs.median), launch: sec(s.launchMs.median),
    };
    shared[p] = Object.keys(NAMES).filter((id) => !s.commonScenarios.includes(id));
    for (const r of g.scenarios) {
      const sc = scenarios.find((x) => x.id === r.id);
      if (!sc) throw new Error(`unknown scenario ${r.id}`);
      if (r.n === 0 && r.skipped > 0) { sc[p][tool] = { status: 'skipped' }; continue; }
      const m = r.scenarioMs;
      sc[p][tool] = {
        status: r.neverPassed ? 'failed' : 'ok',
        median: sec(m.median), p90: sec(m.p90), min: sec(m.min), max: sec(m.max),
        failures: r.failures, runs: r.n, failRate: pct(r.failureRate.rate), ci: [pct(r.failureRate.low), pct(r.failureRate.high)],
        reset: sec(r.resetMs?.median),
      };
      for (const [message, count] of Object.entries(r.errors ?? {})) sc.errors[p].push({ tool, count, message });
    }
  }
}
for (const sc of scenarios) for (const p of PLATS) for (const tool of TOOLS) if (!sc[p][tool]) throw new Error(`${sc.id} ${p} ${tool} missing`);

const previous = qVersions[1] && {
  version: qVersions[1],
  suite: Object.fromEntries(PLATS.map((p) => [p, sec(pick('quiesco', p, qVersions[1]).suite.commonSuiteMs.median)])),
};
const data = {
  sessions: META.sessions,
  measured: META.measured,
  methodology: META.methodology,
  runsPerCombo: Math.min(...PLATS.flatMap((p) => TOOLS.map((t) => suite[p][t].runs))),
  shared, // excluded from the shared suite
  tools: TOOLS,
  quiesco: { version: qVersions[0], ...(previous ? { previous } : {}) },
  suite,
  scenarios,
};
const out = resolve(here, 'assets/benchmark-data.js');
const js = `// Generated by site/build-data.mjs from speed-test-results/. Do not edit by hand.\nwindow.BENCH = ${JSON.stringify(data, null, 1)};\n`;
const changed = (() => { try { return readFileSync(out, 'utf8') !== js; } catch { return true; } })();
writeFileSync(out, js);
console.log(`wrote ${out} from ${src}: Quiesco ${qVersions[0]}${previous ? ` (previous ${previous.version})` : ''}, ${scenarios.length} scenarios${changed ? '' : ' (unchanged)'}`);

// The benchmark page's <lastmod> in sitemap.xml: today, only when the data changed (search engines stop
// trusting a lastmod that moves without the page changing).
if (changed) {
  const sitemap = resolve(here, 'sitemap.xml');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD, JST
  const xml = readFileSync(sitemap, 'utf8');
  const next = xml.replace(/(<loc>https:\/\/quiesco\.dev\/benchmark<\/loc>)(?:<lastmod>[^<]*<\/lastmod>)?/, `$1<lastmod>${today}</lastmod>`);
  if (next === xml && !xml.includes(`/benchmark</loc><lastmod>${today}<`)) throw new Error('sitemap.xml: no https://quiesco.dev/benchmark entry');
  writeFileSync(sitemap, next);
  console.log(`sitemap.xml: /benchmark lastmod ${today}`);
}
for (const p of PLATS) {
  const q = suite[p].quiesco.median;
  for (const t of ['appium', 'detox', 'maestro']) {
    const x = suite[p][t].median;
    console.log(p, t, `${((1 - q / x) * 100).toFixed(1)}% less time`, `${(x / q).toFixed(2)}x`);
  }
}
