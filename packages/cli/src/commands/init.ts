/**
 * `quiesco init [--platforms ios,android,web] [--packages <dir>] [--skip-install]` (requirements.md
 * §6.12): set Quiesco up in an Expo project. Every step says what it did; existing files are never
 * overwritten — when one needs a change Quiesco cannot make safely, the step prints what to add.
 *
 * `--packages <dir>`: install Quiesco from the tarballs in <dir> (`pnpm pack` output) instead of the
 * npm registry, and point the packages' own @quiesco/* dependencies at those tarballs too.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { CliContext, CliPlatform } from '../context.js';
import { PLATFORMS, takeFlag, takeOption } from '../context.js';

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

interface PackageJson {
  name?: string;
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  resolutions?: Record<string, string>;
  pnpm?: { overrides?: Record<string, string> };
  [key: string]: unknown;
}

interface AppJson {
  expo?: {
    scheme?: string | string[];
    plugins?: unknown[];
    ios?: { bundleIdentifier?: string };
    android?: { package?: string };
    [key: string]: unknown;
  };
}

/** Installed into `dependencies`: the app bundles them (stubbed / excluded in production builds). */
const RUNTIME = ['@quiesco/agent', '@quiesco/native'];
/** Installed into `devDependencies`. */
const DEV = ['quiesco', '@quiesco/core', '@quiesco/cucumber', '@quiesco/expo-plugin', '@cucumber/cucumber'];
const WEB_DEV = ['@quiesco/web', 'playwright'];
/** Internal packages pulled in by the ones above; only pinned when installing from tarballs. */
const TRANSITIVE = ['@quiesco/protocol'];

export function detectPackageManager(ctx: CliContext): PackageManager {
  if (ctx.exists(path.join(ctx.cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (ctx.exists(path.join(ctx.cwd, 'yarn.lock'))) return 'yarn';
  if (ctx.exists(path.join(ctx.cwd, 'bun.lock')) || ctx.exists(path.join(ctx.cwd, 'bun.lockb'))) return 'bun';
  return 'npm';
}

/** `@quiesco/agent` → `quiesco-agent-<version>.tgz` (the file name `pnpm pack` / `npm pack` writes). */
export function findTarballs(dir: string, names: readonly string[], list: (d: string) => string[] = (d) => fs.readdirSync(d)): Map<string, string> {
  const files = list(dir).filter((f) => f.endsWith('.tgz'));
  const found = new Map<string, string>();
  for (const name of names) {
    const base = name.replace(/^@/, '').replace('/', '-');
    const match = files.find((f) => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d[^/]*\\.tgz$`).test(f));
    if (match !== undefined) found.set(name, path.join(dir, match));
  }
  return found;
}

function addCommand(pm: PackageManager, dev: boolean, specs: string[]): { command: string; args: string[] } {
  switch (pm) {
    case 'pnpm':
      return { command: 'pnpm', args: ['add', ...(dev ? ['-D'] : []), ...specs] };
    case 'yarn':
      return { command: 'yarn', args: ['add', ...(dev ? ['-D'] : []), ...specs] };
    case 'bun':
      return { command: 'bun', args: ['add', ...(dev ? ['-d'] : []), ...specs] };
    case 'npm':
      return { command: 'npm', args: ['install', ...(dev ? ['--save-dev'] : []), ...specs] };
  }
}

function readJson<T>(ctx: CliContext, file: string): T | null {
  const text = ctx.readFile(file);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const writeJson = (ctx: CliContext, file: string, value: unknown): void => ctx.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

const METRO_CONFIG = `// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withQuiesco } = require('@quiesco/agent/metro');

// withQuiesco: the real agent when EXPO_PUBLIC_QUIESCO=1 (e2e builds), a no-op stub otherwise.
module.exports = withQuiesco(getDefaultConfig(__dirname));
`;

function quiescoConfig(app: AppJson, platforms: readonly CliPlatform[]): string {
  const scheme = Array.isArray(app.expo?.scheme) ? app.expo?.scheme[0] : app.expo?.scheme;
  const lines = [`import { defineConfig } from '@quiesco/core';`, '', 'export default defineConfig({', '  apps: {'];
  if (platforms.includes('ios')) {
    lines.push(
      '    ios: {',
      `      bundleId: '${app.expo?.ios?.bundleIdentifier ?? 'com.example.app'}',${app.expo?.ios?.bundleIdentifier === undefined ? ' // TODO: expo.ios.bundleIdentifier' : ''}`,
      '      // Simulator build made with EXPO_PUBLIC_QUIESCO=1 (expo prebuild + xcodebuild, or an EAS e2e build).',
      "      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/App.app', // TODO: your .app",
      "      // A dev client loading JS from Metro (EXPO_PUBLIC_QUIESCO=1 npx expo start). Remove for a bundled build.",
      "      devClient: { metroUrl: 'http://localhost:8081' },",
      '    },',
    );
  }
  if (platforms.includes('android')) {
    lines.push(
      '    android: {',
      `      package: '${app.expo?.android?.package ?? 'com.example.app'}',${app.expo?.android?.package === undefined ? ' // TODO: expo.android.package' : ''}`,
      "      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',",
      `      devClient: { scheme: '${scheme ?? 'myapp'}', metroUrl: 'http://localhost:8081' },${scheme === undefined ? ' // TODO: expo.scheme' : ''}`,
      '    },',
    );
  }
  if (platforms.includes('web')) {
    lines.push("    // Static export made with EXPO_PUBLIC_QUIESCO=1 npx expo export --platform web.", "    web: { distDir: 'dist' },");
  }
  lines.push('  },', '});', '');
  return lines.join('\n');
}

const CUCUMBER_CONFIG = `export default {
  paths: ['features/**/*.feature'],
  import: ['features/support/**/*.ts', 'features/step_definitions/**/*.ts'],
  format: ['progress'],
};
`;

const SUPPORT = `// this.app (the Quiesco driver) in every step, and the lifecycle hooks: one app session per run,
// a soft reset before each scenario, screenshot + element tree on failure.
import '@quiesco/cucumber/register';
`;

const FEATURE = `Feature: The app starts
  Scenario: The home screen is shown
    Then the home screen is visible
`;

const STEPS = `import { Then } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';

// Steps talk to the app through this.app and never wait or sleep: every call waits for the app to
// become idle first. Give the element testID="home" (or change the id here).
Then('the home screen is visible', async function (this: QuiescoWorld) {
  await this.app.expectVisible({ id: 'home' });
});
`;

export interface InitStep {
  status: 'created' | 'updated' | 'skipped' | 'ran' | 'todo';
  what: string;
  note?: string;
}

export async function initCommand(args: readonly string[], ctx: CliContext): Promise<number> {
  let rest = [...args];
  const platformsOpt = takeOption(rest, '--platforms');
  rest = platformsOpt.rest;
  const packagesOpt = takeOption(rest, '--packages');
  rest = packagesOpt.rest;
  const skipInstall = takeFlag(rest, '--skip-install');
  rest = skipInstall.rest;
  if (rest.length > 0) {
    ctx.err(`quiesco init: unknown arguments ${rest.join(' ')}`);
    return 2;
  }

  const pkgFile = path.join(ctx.cwd, 'package.json');
  const pkg = readJson<PackageJson>(ctx, pkgFile);
  if (pkg === null || (pkg.dependencies?.['expo'] === undefined && pkg.devDependencies?.['expo'] === undefined)) {
    ctx.err(`quiesco init: ${ctx.cwd} is not an Expo project (no expo dependency in package.json).`);
    return 1;
  }
  const hasWebDeps = pkg.dependencies?.['react-native-web'] !== undefined;
  const platforms: CliPlatform[] =
    platformsOpt.value !== undefined
      ? platformsOpt.value.split(',').map((p) => {
          if (!(PLATFORMS as readonly string[]).includes(p)) throw new Error(`Unknown platform "${p}"`);
          return p as CliPlatform;
        })
      : ['ios', 'android', ...(hasWebDeps ? (['web'] as const) : [])];

  const steps: InitStep[] = [];
  const pm = detectPackageManager(ctx);

  // 1. Dependencies.
  const runtime = [...RUNTIME];
  const dev = [...DEV, ...(platforms.includes('web') ? WEB_DEV : [])];
  let spec = (name: string): string => name;
  if (packagesOpt.value !== undefined) {
    const dir = path.resolve(ctx.cwd, packagesOpt.value);
    const ours = [...runtime, ...dev, ...TRANSITIVE].filter((n) => n === 'quiesco' || n.startsWith('@quiesco/'));
    const tarballs = findTarballs(dir, ours);
    const missing = ours.filter((n) => !tarballs.has(n));
    if (missing.length > 0) {
      ctx.err(`quiesco init: no tarball for ${missing.join(', ')} in ${dir}`);
      return 1;
    }
    spec = (name) => (tarballs.has(name) ? `file:${tarballs.get(name) as string}` : name);
    // Their own dependencies on each other ("@quiesco/protocol": "0.0.0") must resolve to the tarballs too.
    const pins = Object.fromEntries([...tarballs].map(([n, f]) => [n, `file:${f}`]));
    const current = readJson<PackageJson>(ctx, pkgFile) as PackageJson;
    if (pm === 'pnpm') current.pnpm = { ...current.pnpm, overrides: { ...current.pnpm?.overrides, ...pins } };
    else if (pm === 'yarn') current.resolutions = { ...current.resolutions, ...pins };
    else current.overrides = { ...current.overrides, ...pins };
    writeJson(ctx, pkgFile, current);
    steps.push({ status: 'updated', what: 'package.json', note: `pinned ${tarballs.size} Quiesco packages to the tarballs in ${packagesOpt.value}` });
  }
  const installs = [addCommand(pm, false, runtime.map(spec)), addCommand(pm, true, dev.map(spec))];
  for (const cmd of installs) {
    const line = `${cmd.command} ${cmd.args.join(' ')}`;
    if (skipInstall.present) {
      steps.push({ status: 'todo', what: 'install', note: line });
      continue;
    }
    ctx.out(`$ ${line}`);
    const r = await ctx.exec(cmd.command, cmd.args, { cwd: ctx.cwd });
    if (r.code !== 0) {
      ctx.err(r.stderr.trim() || r.stdout.trim());
      ctx.err(`quiesco init: \`${line}\` failed (exit ${r.code}).`);
      return 1;
    }
    steps.push({ status: 'ran', what: 'install', note: line });
  }

  // 2. Config plugin in app.json.
  const appFile = path.join(ctx.cwd, 'app.json');
  const app = readJson<AppJson>(ctx, appFile) ?? {};
  if (app.expo !== undefined) {
    const plugins = app.expo.plugins ?? [];
    if (plugins.some((p) => p === '@quiesco/expo-plugin' || (Array.isArray(p) && p[0] === '@quiesco/expo-plugin'))) {
      steps.push({ status: 'skipped', what: 'app.json', note: '@quiesco/expo-plugin already listed' });
    } else {
      app.expo.plugins = [...plugins, '@quiesco/expo-plugin'];
      writeJson(ctx, appFile, app);
      steps.push({ status: 'updated', what: 'app.json', note: 'added "@quiesco/expo-plugin" to expo.plugins' });
    }
  } else {
    steps.push({ status: 'todo', what: 'app config', note: 'add "@quiesco/expo-plugin" to the plugins of your app config' });
  }

  // 3. Metro.
  const metro = ['metro.config.js', 'metro.config.cjs', 'metro.config.mjs', 'metro.config.ts'].map((f) => path.join(ctx.cwd, f)).find((f) => ctx.exists(f));
  if (metro === undefined) {
    ctx.writeFile(path.join(ctx.cwd, 'metro.config.js'), METRO_CONFIG);
    steps.push({ status: 'created', what: 'metro.config.js', note: 'wrapped with withQuiesco()' });
  } else if ((ctx.readFile(metro) ?? '').includes('withQuiesco')) {
    steps.push({ status: 'skipped', what: path.basename(metro), note: 'already uses withQuiesco()' });
  } else {
    steps.push({
      status: 'todo',
      what: path.basename(metro),
      note: "wrap the exported config: const { withQuiesco } = require('@quiesco/agent/metro'); module.exports = withQuiesco(config);",
    });
  }

  // 4. Entry file: @quiesco/agent first.
  const latest = readJson<PackageJson>(ctx, pkgFile) as PackageJson;
  const main = latest.main;
  if (main === undefined || /(^|\/)expo-router\/entry$/.test(main) || main === 'expo/AppEntry') {
    const entryFile = path.join(ctx.cwd, 'index.ts');
    if (ctx.exists(entryFile)) {
      steps.push({ status: 'todo', what: 'index.ts', note: `exists but "main" is ${main ?? 'unset'}; import '@quiesco/agent' on its first line and set "main": "index.ts"` });
    } else {
      const original = main ?? 'expo/AppEntry';
      ctx.writeFile(
        entryFile,
        `// Must stay the first import: Quiesco's agent hooks into React before the app loads.\n// In builds without EXPO_PUBLIC_QUIESCO=1, metro.config.js swaps it for a no-op stub.\nimport '@quiesco/agent';\nimport '${original}';\n`,
      );
      latest.main = 'index.ts';
      writeJson(ctx, pkgFile, latest);
      steps.push({ status: 'created', what: 'index.ts', note: `imports @quiesco/agent, then ${original}; package.json "main" set to index.ts` });
    }
  } else {
    const entry = [main, `${main}.ts`, `${main}.tsx`, `${main}.js`].map((f) => path.join(ctx.cwd, f)).find((f) => ctx.exists(f));
    const src = entry !== undefined ? (ctx.readFile(entry) ?? '') : null;
    if (src === null || entry === undefined) {
      steps.push({ status: 'todo', what: 'entry file', note: `cannot find "${main}"; import '@quiesco/agent' on its first line` });
    } else if (src.includes('@quiesco/agent')) {
      steps.push({ status: 'skipped', what: path.basename(entry), note: 'already imports @quiesco/agent' });
    } else {
      ctx.writeFile(entry, `import '@quiesco/agent'; // first: Quiesco hooks into React before the app loads\n${src}`);
      steps.push({ status: 'updated', what: path.basename(entry), note: "added import '@quiesco/agent' as the first line" });
    }
  }

  // 5. quiesco.config.ts, cucumber config, features.
  const write = (rel: string, content: string, note: string, alternatives: readonly string[] = [rel]): void => {
    const existing = alternatives.find((f) => ctx.exists(path.join(ctx.cwd, f)));
    if (existing !== undefined) {
      steps.push({ status: 'skipped', what: existing, note: 'already exists' });
      return;
    }
    ctx.writeFile(path.join(ctx.cwd, rel), content);
    steps.push({ status: 'created', what: rel, note });
  };
  write('quiesco.config.ts', quiescoConfig(app, platforms), `apps: ${platforms.join(', ')}`, ['quiesco.config.ts', 'quiesco.config.mts', 'quiesco.config.js', 'quiesco.config.mjs']);
  write('cucumber.mjs', CUCUMBER_CONFIG, 'features/**/*.feature', ['cucumber.mjs', 'cucumber.js', 'cucumber.cjs', 'cucumber.json', 'cucumber.yaml', 'cucumber.yml']);
  write('features/package.json', '{ "type": "module" }\n', 'step files are ES modules');
  write('features/support/quiesco.ts', SUPPORT, 'this.app and the lifecycle hooks');
  write('features/app.feature', FEATURE, 'a first scenario');
  write('features/step_definitions/app.steps.ts', STEPS, 'its step');

  // 6. Scripts.
  const scripts = { ...(latest.scripts ?? {}) };
  const wanted: Record<string, string> = {
    'e2e:start': 'EXPO_PUBLIC_QUIESCO=1 expo start',
    ...(platforms.includes('web') ? { 'e2e:web': 'EXPO_PUBLIC_QUIESCO=1 expo export --platform web && quiesco test --platform web' } : {}),
    ...(platforms.includes('android') ? { 'e2e:android': 'quiesco test --platform android' } : {}),
    ...(platforms.includes('ios') ? { 'e2e:ios': 'quiesco test --platform ios' } : {}),
  };
  const added = Object.keys(wanted).filter((k) => scripts[k] === undefined);
  if (added.length > 0) {
    for (const k of added) scripts[k] = wanted[k] as string;
    const now = readJson<PackageJson>(ctx, pkgFile) as PackageJson;
    now.scripts = scripts;
    writeJson(ctx, pkgFile, now);
    steps.push({ status: 'updated', what: 'package.json', note: `scripts: ${added.join(', ')}` });
  }

  const icon = { created: '+', updated: '~', skipped: '=', ran: '$', todo: '!' } as const;
  ctx.out('');
  for (const s of steps) ctx.out(`${icon[s.status]} ${s.what}${s.note !== undefined ? ` — ${s.note}` : ''}`);
  ctx.out('');
  ctx.out('Next:');
  ctx.out("  1. Wrap the root layout in <QuiescoRoot> (import { QuiescoRoot } from '@quiesco/agent').");
  ctx.out('  2. Give the home screen testID="home" (features/step_definitions/app.steps.ts looks for it).');
  if (platforms.includes('web')) ctx.out('  3. npx playwright install chromium, then npm run e2e:web');
  if (platforms.some((p) => p !== 'web')) ctx.out('  •  iOS / Android: build the app with EXPO_PUBLIC_QUIESCO=1, fix binaryPath in quiesco.config.ts, run `npx quiesco doctor`.');
  return 0;
}
