#!/usr/bin/env node
// @ts-check
/**
 * Expo SDK compatibility projects (.planning/2026-11-16-expo-sdk-55-57).
 *
 * Makes a copy of examples/todo-app on a given Expo SDK, with the Quiesco packages of this checkout
 * installed from tarballs (as a user gets them from npm), so the example's features can be run on it.
 *
 *   node scripts/sdk-compat.mjs --sdk 55 [--sdk 56 ...] [--out <dir>] [--skip-build] [--typecheck]
 *
 * For each SDK, <out>/sdk-<N>/ gets:
 *   1. the example's sources (no node_modules / android / ios / dist / reports);
 *   2. package.json: `workspace:*` → `file:<tarball>` (also as overrides, so packages depending on each
 *      other get the same tarballs), `expo` → `^N.0.0`; .npmrc `legacy-peer-deps` (optional peers of
 *      some community modules, e.g. datetimepicker → react-native-windows, conflict on older SDKs);
 *   3. overlays for what the example uses from a newer SDK (OVERLAYS below);
 *   4. `npm install`, then `npx expo install --fix` (aligns react / react-native / expo-* / community
 *      modules to the SDK's bundledNativeModules.json; jest and typescript stay as the example has them).
 *
 * A copy, not a workspace package: Metro and autolinking must see a plain node_modules (autolinking
 * filters symlinked modules, docs/spikes/06-prod-strip.md §3), and the workspace lockfile stays on SDK 58.
 * Run the features in the copy with its own scripts (`npm run build:web`, `npm run test:e2e:web`, ...).
 *
 * Exit code: 0 done, 1 a step failed, 2 usage error.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'examples/todo-app');
const OVERLAY_DIR = path.join(ROOT, 'scripts/sdk-compat/overlays');
const SUPPORTED = [55, 56, 57, 58];
/** Not copied from the example: installed, generated or built. */
const SKIP = new Set(['node_modules', 'android', 'ios', 'dist', 'reports', 'artifacts', '.expo']);

/**
 * What the example uses from a newer SDK than the target, and its replacement there.
 * `files`: copied over the example's (from scripts/sdk-compat/overlays/<dir>/); `replace`: [file, from, to].
 * `plugin`: a config plugin file from `files` (with its props) added to app.json's plugins. Each overlay
 * applies to SDKs from `from` (default: any) below `below`.
 * @type {{ from?: number, below: number, why: string, files?: { dir: string, paths: string[] }, replace?: [string, string, string][], plugin?: [string, Record<string, string>] }[]}
 */
const OVERLAYS = [
  {
    below: 58,
    why: 'react-native-gesture-handler 3 hook API (usePanGesture, ...) → RNGH 2 builder API (SDK 55–57 bundle RNGH 2.x)',
    files: { dir: 'rngh2', paths: ['src/app/gestures.tsx'] },
  },
  {
    below: 56,
    why: "expo-router/react-navigation (expo-router 56+) → @react-navigation/elements (expo-router 55 depends on React Navigation)",
    replace: [
      ['src/app/index.tsx', "'expo-router/react-navigation'", "'@react-navigation/elements'"],
      ['src/components/ScreenTransition.tsx', "'expo-router/react-navigation'", "'@react-navigation/elements'"],
    ],
  },
  {
    below: 56,
    why: 'Xcode 27: expo-router 55 needs iOS 16 (unguarded API) and some pods declare iOS < 15 → app and pods iOS 16.0 (not needed with Xcode 26)',
    files: { dir: 'xcode27', paths: ['sdk-compat-ios.js'] },
    plugin: ['./sdk-compat-ios.js', { appTarget: '16.0', podsMin: '16.0' }],
  },
  {
    from: 56,
    below: 58,
    why: 'Xcode 27: some pods / resource bundles declare iOS < 15 → pods iOS 16.4, the app default (not needed with Xcode 26)',
    files: { dir: 'xcode27', paths: ['sdk-compat-ios.js'] },
    plugin: ['./sdk-compat-ios.js', { podsMin: '16.4' }],
  },
];

function usage(/** @type {string} */ message) {
  console.error(`sdk-compat: ${message}`);
  console.error('usage: node scripts/sdk-compat.mjs --sdk <55|56|57|58> [--sdk ...] [--out <dir>] [--skip-build] [--typecheck]');
  process.exit(2);
}

function parseArgs(/** @type {string[]} */ argv) {
  /** @type {number[]} */
  const sdks = [];
  let out = path.join(os.tmpdir(), 'quiesco-sdk-compat');
  let skipBuild = false;
  let typecheck = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sdk') {
      const n = Number(argv[++i]);
      if (!SUPPORTED.includes(n)) usage(`bad --sdk ${argv[i]} (one of ${SUPPORTED.join(', ')})`);
      sdks.push(n);
    } else if (a === '--out') out = path.resolve(argv[++i] ?? usage('--out needs a directory'));
    else if (a === '--skip-build') skipBuild = true;
    else if (a === '--typecheck') typecheck = true;
    else usage(`unknown argument ${a}`);
  }
  if (sdks.length === 0) usage('give at least one --sdk');
  return { sdks, out, skipBuild, typecheck };
}

/**
 * Run a command, streaming its output; exit 1 when it fails.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 */
function run(cmd, args, cwd) {
  console.log(`\n$ (${cwd}) ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' } });
  if (r.status !== 0) {
    console.error(`sdk-compat: ${cmd} ${args.join(' ')} failed (exit ${r.status ?? r.signal})`);
    process.exit(1);
  }
}

/** Pack every publishable package into <out>/tgz; returns package name → tarball path. */
function pack(/** @type {string} */ out) {
  const dest = path.join(out, 'tgz');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  /** @type {Record<string, string>} */
  const tarballs = {};
  for (const dir of fs.readdirSync(path.join(ROOT, 'packages'))) {
    const pkgDir = path.join(ROOT, 'packages', dir);
    const pkgFile = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgFile)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    if (pkg.private === true) continue;
    const before = new Set(fs.readdirSync(dest));
    run('pnpm', ['pack', '--pack-destination', dest], pkgDir);
    const made = fs.readdirSync(dest).filter((f) => !before.has(f));
    if (made.length !== 1) throw new Error(`pnpm pack in ${dir} made ${made.length} files`);
    tarballs[pkg.name] = path.join(dest, made[0]);
  }
  return tarballs;
}

/**
 * @param {number} sdk
 * @param {string} out
 * @param {Record<string, string>} tarballs
 * @param {boolean} typecheck
 */
function makeProject(sdk, out, tarballs, typecheck) {
  const dir = path.join(out, `sdk-${sdk}`);
  console.log(`\n=== Expo SDK ${sdk} → ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(APP, dir, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) || path.dirname(src) !== APP });

  const pkgFile = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  /** @type {Record<string, string>} */
  const files = Object.fromEntries(Object.entries(tarballs).map(([name, file]) => [name, `file:${file}`]));
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (typeof spec !== 'string' || !spec.startsWith('workspace:')) continue;
      if (files[name] === undefined) throw new Error(`no tarball for ${name}`);
      pkg[field][name] = files[name];
    }
  }
  pkg.name = `quiesco-example-sdk-${sdk}`;  pkg.dependencies.expo = `^${sdk}.0.0`;
  pkg.overrides = files;
  // Test tooling is not tied to the SDK; `expo install --fix` would move jest to 29 (@quiesco/jest needs 30+).
  pkg.expo = { ...pkg.expo, install: { exclude: ['jest', 'typescript'] } };
  fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, '.npmrc'), 'legacy-peer-deps=true\n');

  for (const o of OVERLAYS) {
    if (sdk >= o.below || sdk < (o.from ?? 0)) continue;
    console.log(`overlay (SDK ${o.from !== undefined ? `${o.from}–${o.below - 1}` : `< ${o.below}`}): ${o.why}`);
    for (const p of o.files?.paths ?? []) fs.copyFileSync(path.join(OVERLAY_DIR, o.files?.dir ?? '', p), path.join(dir, p));
    if (o.plugin !== undefined) {
      const appFile = path.join(dir, 'app.json');
      const app = JSON.parse(fs.readFileSync(appFile, 'utf8'));
      app.expo.plugins = [...(app.expo.plugins ?? []), o.plugin];
      fs.writeFileSync(appFile, `${JSON.stringify(app, null, 2)}\n`);
    }
    for (const [file, from, to] of o.replace ?? []) {
      const f = path.join(dir, file);
      const text = fs.readFileSync(f, 'utf8');
      if (!text.includes(from)) throw new Error(`overlay: ${file} no longer contains ${from}; update OVERLAYS`);
      fs.writeFileSync(f, text.replaceAll(from, to));
    }
  }

  run('npm', ['install', '--no-audit', '--no-fund'], dir);
  run('npx', ['expo', 'install', '--fix'], dir);
  if (typecheck) run('npx', ['tsc', '--noEmit'], dir);
  return dir;
}

const { sdks, out, skipBuild, typecheck } = parseArgs(process.argv.slice(2));
if (!skipBuild) run('pnpm', ['build'], ROOT);
const tarballs = pack(out);
const dirs = sdks.map((sdk) => makeProject(sdk, out, tarballs, typecheck));
console.log(`\nsdk-compat: ready\n${dirs.map((d) => `  ${d}`).join('\n')}`);
