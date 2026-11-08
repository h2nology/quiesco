#!/usr/bin/env node
// @ts-check
/**
 * Production-strip check (requirements.md §6.8, docs/spikes/06-prod-strip.md, task 4.7).
 *
 * Builds the example app (examples/todo-app) for real and scans the artifacts:
 *   - prod (no EXPO_PUBLIC_QUIESCO): no agent JS, no @quiesco/native code may be present;
 *   - e2e  (EXPO_PUBLIC_QUIESCO=1):  every marker must be present (control group).
 *
 *   node scripts/check-prod-strip.mjs [--platform web|android|ios|all] [--mode prod|e2e|both] [--allow-clean]
 *
 * | platform | build                                                   | scanned                              |
 * |----------|---------------------------------------------------------|--------------------------------------|
 * | web      | expo export --platform web                              | exported JS                          |
 * | android  | expo prebuild --clean + gradlew assembleRelease (R8)    | unzipped APK: dex + Hermes bundle    |
 * | ios      | expo prebuild --clean + xcodebuild Release (simulator)  | the .app: binary, frameworks, bundle |
 *
 * Native checks run in the real project directory (a copy is not reliable: autolinking filters
 * symlinked modules, spike 06 §3), and `prebuild --clean` deletes android/ / ios/ — including a dev
 * client built for e2e runs. The script refuses to do that unless `--allow-clean` is given; rebuild the
 * dev client afterwards (`pnpm build:android` / `pnpm build:ios`). CI starts from a fresh checkout.
 *
 * Exit code: 0 all as expected, 1 a check failed, 2 usage / environment error.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANDROID_MARKERS, IOS_MARKERS, JS_MARKERS, judge, report, scan } from './prod-strip/scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'examples/todo-app');
const IOS_SCHEME = 'QuiescoTodo';

/** @typedef {import('./prod-strip/scan.mjs').Mode} Mode */

function usage(/** @type {string} */ message) {
  console.error(`check-prod-strip: ${message}`);
  console.error('usage: node scripts/check-prod-strip.mjs [--platform web|android|ios|all] [--mode prod|e2e|both] [--allow-clean]');
  process.exit(2);
}

function parseArgs(/** @type {string[]} */ argv) {
  let platform = 'all';
  let mode = 'both';
  let allowClean = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform') platform = argv[++i] ?? '';
    else if (a === '--mode') mode = argv[++i] ?? '';
    else if (a === '--allow-clean') allowClean = true;
    else usage(`unknown argument ${a}`);
  }
  if (!['web', 'android', 'ios', 'all'].includes(platform)) usage(`bad --platform ${platform}`);
  if (!['prod', 'e2e', 'both'].includes(mode)) usage(`bad --mode ${mode}`);
  const platforms = platform === 'all' ? ['web', 'android', 'ios'] : [platform];
  // e2e last: the project is left prebuilt for e2e, the mode the example is normally used in.
  /** @type {Mode[]} */
  const modes = mode === 'both' ? ['prod', 'e2e'] : [/** @type {Mode} */ (mode)];
  return { platforms, modes, allowClean };
}

/** Environment of a build: EXPO_PUBLIC_QUIESCO is removed for prod, so a value from the shell cannot leak in. */
function buildEnv(/** @type {Mode} */ mode) {
  const env = { ...process.env, CI: '1' };
  delete env.EXPO_PUBLIC_QUIESCO;
  if (mode === 'e2e') env.EXPO_PUBLIC_QUIESCO = '1';
  return env;
}

/**
 * Run a command, streaming its output; throw when it fails.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} opts
 */
function run(cmd, args, opts) {
  console.log(`\n$ (${path.relative(ROOT, opts.cwd) || '.'}) ${opts.env.EXPO_PUBLIC_QUIESCO === '1' ? 'EXPO_PUBLIC_QUIESCO=1 ' : ''}${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ''} failed with exit code ${r.status}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-prod-strip-'));

/** @type {Record<string, (mode: Mode) => { roots: string[], markers: import('./prod-strip/scan.mjs').Marker[] }>} */
const builders = {
  web(mode) {
    const out = path.join(tmp, `web-${mode}`);
    run('npx', ['expo', 'export', '--platform', 'web', '--clear', '--output-dir', out], { cwd: APP, env: buildEnv(mode) });
    return { roots: [out], markers: JS_MARKERS };
  },
  android(mode) {
    const env = buildEnv(mode);
    run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean'], { cwd: APP, env });
    run('./gradlew', ['assembleRelease', '--console=plain'], { cwd: path.join(APP, 'android'), env });
    const apk = path.join(APP, 'android/app/build/outputs/apk/release/app-release.apk');
    const out = path.join(tmp, `android-${mode}`);
    run('unzip', ['-q', '-o', apk, '-d', out], { cwd: APP, env });
    return { roots: [out], markers: [...ANDROID_MARKERS, ...JS_MARKERS] };
  },
  ios(mode) {
    const env = buildEnv(mode);
    run('npx', ['expo', 'prebuild', '--platform', 'ios', '--clean'], { cwd: APP, env });
    const derived = path.join(APP, 'ios/build-prod-strip');
    run(
      'xcodebuild',
      [
        '-workspace', `ios/${IOS_SCHEME}.xcworkspace`, '-scheme', IOS_SCHEME, '-configuration', 'Release',
        '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', derived,
        'CODE_SIGNING_ALLOWED=NO', '-quiet', 'build',
      ],
      { cwd: APP, env },
    );
    const app = path.join(derived, `Build/Products/Release-iphonesimulator/${IOS_SCHEME}.app`);
    return { roots: [app], markers: [...IOS_MARKERS, ...JS_MARKERS] };
  },
};

function main() {
  const { platforms, modes, allowClean } = parseArgs(process.argv.slice(2));
  const native = platforms.filter((p) => p !== 'web');
  const existing = native.filter((p) => fs.existsSync(path.join(APP, p)));
  if (existing.length > 0 && !allowClean) {
    usage(
      `examples/todo-app/${existing.join('/, examples/todo-app/')}/ exists and \`expo prebuild --clean\` would delete it ` +
        '(including an e2e dev client build). Pass --allow-clean, then rebuild the dev client afterwards with ' +
        existing.map((p) => `\`pnpm build:${p}\``).join(' / ') + '.',
    );
  }

  /** @type {{ platform: string, mode: Mode, hits: import('./prod-strip/scan.mjs').MarkerHit[] }[]} */
  const results = [];
  /** @type {string[]} */
  const failures = [];
  for (const platform of platforms) {
    for (const mode of modes) {
      const builder = /** @type {(typeof builders)[string]} */ (builders[platform]);
      const started = Date.now();
      const { roots, markers } = builder(mode);
      const hits = scan(roots, markers);
      results.push({ platform, mode, hits });
      failures.push(...judge(hits, mode).map((f) => `${platform} ${mode}: ${f}`));
      console.log(`\n[prod-strip] ${platform} ${mode}: built and scanned in ${Math.round((Date.now() - started) / 1000)}s`);
    }
  }

  console.log(`\n${report(results)}\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failures.length > 0) {
    console.error(failures.map((f) => `❌ ${f}`).join('\n'));
    process.exit(1);
  }
  console.log('✅ production builds contain no Quiesco code; e2e builds contain every marker');
}

main();
