/**
 * `quiesco init [--platforms ios,android,web] [--packages <dir>] [--skip-install]` (requirements.md
 * §6.12): set Quiesco up in an Expo project. Every step says what it did; existing files are never
 * overwritten — when one needs a change Quiesco cannot make safely, the step prints what to add.
 *
 * `--packages <dir>`: install Quiesco from the tarballs in <dir> (`pnpm pack` output) instead of the
 * npm registry, and point the packages' own @quiesco/* dependencies at those tarballs too.
 */
import path from 'node:path';

import type { CliContext, CliPlatform } from '../context.js';
import { PLATFORMS, takeFlag, takeOption } from '../context.js';
import { MIN_EXPO_SDK, UPGRADE_SDK_FIX, expoSdk } from '../expo-sdk.js';
import { entryFile, registeredRoot, rootSourceFiles, wrapRegisteredRoot } from '../project.js';
import type { AppJson, InitStep, PackageJson, StepLog } from '../setup-steps.js';
import { DEV, RUNTIME, WEB_DEV, detectPackageManager, ensureAppIds, ensureScripts, ensureTsconfig, firstScheme, installPackages, printSteps, readJson, writeJson } from '../setup-steps.js';
import { upgradeCommand } from './upgrade.js';

export { detectPackageManager, findTarballs } from '../setup-steps.js';
export type { InitStep } from '../setup-steps.js';

const METRO_CONFIG = `// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withQuiesco } = require('@quiesco/agent/metro');

// withQuiesco: the real agent when EXPO_PUBLIC_QUIESCO=1 (e2e builds), a no-op stub otherwise.
module.exports = withQuiesco(getDefaultConfig(__dirname));
`;

/**
 * The `.app` that `expo prebuild` + xcodebuild produce: the Xcode project is named after `expo.name`,
 * reduced to ASCII letters and digits (as @expo/config-plugins' `sanitizedName` does; "my-app" ⇒ "myapp").
 * `exact` is false when the name has other characters: Expo transliterates some of them (ø ⇒ o), which
 * this does not attempt.
 */
export function iosAppName(name: string | undefined): { name: string; exact: boolean } {
  if (name === undefined) return { name: 'app', exact: false };
  const ascii = name
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[\W_]+/g, '');
  return { name: ascii || 'app', exact: /^[\x20-\x7e]*$/.test(name) };
}

function quiescoConfig(app: AppJson, platforms: readonly CliPlatform[]): string {
  const scheme = firstScheme(app);
  const ios = iosAppName(app.expo?.name);
  const lines = [`import { defineConfig } from '@quiesco/core';`, '', 'export default defineConfig({', '  apps: {'];
  if (platforms.includes('ios')) {
    lines.push(
      '    ios: {',
      `      bundleId: '${app.expo?.ios?.bundleIdentifier ?? 'com.example.app'}',${app.expo?.ios?.bundleIdentifier === undefined ? ' // TODO: expo.ios.bundleIdentifier' : ''}`,
      '      // Simulator build made with EXPO_PUBLIC_QUIESCO=1: `npx quiesco build ios` writes it here (or an EAS e2e build).',
      `      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/${ios.name}.app',${ios.exact ? '' : ' // TODO: check the .app name'}`,
      "      // A dev client loading JS from Metro (quiesco test starts it when it is not running). Remove for a bundled build.",
      "      devClient: { metroUrl: 'http://localhost:8081' },",
      '    },',
    );
  }
  if (platforms.includes('android')) {
    lines.push(
      '    android: {',
      `      package: '${app.expo?.android?.package ?? 'com.example.app'}',${app.expo?.android?.package === undefined ? ' // TODO: expo.android.package' : ''}`,
      "      // `npx quiesco build android` writes it here (EXPO_PUBLIC_QUIESCO=1).",
      "      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',",
      `      devClient: { scheme: '${scheme ?? 'myapp'}', metroUrl: 'http://localhost:8081' },${scheme === undefined ? ' // TODO: expo.scheme' : ''}`,
      '    },',
    );
  }
  if (platforms.includes('web')) {
    lines.push("    // Static export made with EXPO_PUBLIC_QUIESCO=1 npx expo export --platform web.", "    web: { distDir: 'dist' },");
  }
  lines.push('  },');
  const native = platforms.filter((p) => p !== 'web');
  if (native.length > 0) {
    lines.push(
      '  // Which simulator / emulator to use. Default: the booted one. To let Quiesco boot one, name it',
      '  // (`xcrun simctl list devices`, `emulator -list-avds`); `os` picks the runtime when several have it.',
      '  // devices: {',
      ...(native.includes('ios') ? ["  //   ios: { device: 'iPhone 17', os: '27.0' },"] : []),
      ...(native.includes('android') ? ["  //   android: { avd: 'Medium_Phone_API_37.0' },"] : []),
      '  // },',
    );
  }
  lines.push(
    '  // A decorative animation that runs for minutes (the default Expo template spins a glow on the home',
    "  // screen) never lets the screen settle: give it a testID and list it here.",
    "  // sync: { ignoreElements: ['logo-glow'] },",
    '});',
    '',
  );
  return lines.join('\n');
}

// No `paths`: cucumber-js already defaults to features/**/*.feature, and paths set here are merged with the
// ones given on the command line, so `quiesco test features/x.feature` would run every feature (issue #8).
const CUCUMBER_CONFIG = `export default {
  import: ['features/support/**/*.ts', 'features/step_definitions/**/*.ts'],
  format: ['progress'],
};
`;

const SUPPORT = `// this.app (the Quiesco driver) in every step, and the lifecycle hooks: one app session per run,
// a soft reset before each scenario, screenshot + element tree on failure.
//
// Step and support files run with Node's type stripping, not tsc: relative imports name the .ts file
// (import { TodoDriver } from './todo-driver.ts'), and TypeScript syntax that generates code is not
// supported (parameter properties such as constructor(private app: Driver), enum, namespace).
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

export async function initCommand(args: readonly string[], ctx: CliContext): Promise<number> {
  if (args.includes('--upgrade')) return upgradeCommand(args.filter((a) => a !== '--upgrade'), ctx);
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
  const sdk = expoSdk(ctx, pkg.dependencies?.['expo'] ?? pkg.devDependencies?.['expo']);
  if (sdk !== null && sdk.sdk < MIN_EXPO_SDK) ctx.err(`quiesco init: warning: this app is on Expo SDK ${sdk.sdk} (expo ${sdk.version}). ${UPGRADE_SDK_FIX}`);
  const hasWebDeps = pkg.dependencies?.['react-native-web'] !== undefined;
  const platforms: CliPlatform[] =
    platformsOpt.value !== undefined
      ? platformsOpt.value.split(',').map((p) => {
          if (!(PLATFORMS as readonly string[]).includes(p)) throw new Error(`Unknown platform "${p}"`);
          return p as CliPlatform;
        })
      : ['ios', 'android', ...(hasWebDeps ? (['web'] as const) : [])];

  const steps: InitStep[] = [];
  const log: StepLog = { ctx, steps, dryRun: false };
  const pm = detectPackageManager(ctx);

  // 1. Dependencies.
  const runtime = [...RUNTIME];
  const dev = [...DEV, ...(platforms.includes('web') ? WEB_DEV : [])];
  const installed = await installPackages(log, {
    pm,
    runtime,
    dev,
    ...(packagesOpt.value !== undefined ? { packagesDir: packagesOpt.value } : {}),
    skipInstall: skipInstall.present,
  });
  if (!installed) return 1;

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

  // 2b. App IDs (issue #34): app.json without them builds an app with Expo's defaults, not the config's.
  const appWithIds = ensureAppIds(log, platforms);

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
    const entry = entryFile(ctx, main);
    const src = entry !== null ? (ctx.readFile(entry) ?? '') : null;
    if (src === null || entry === null) {
      steps.push({ status: 'todo', what: 'entry file', note: `cannot find "${main}"; import '@quiesco/agent' on its first line` });
    } else {
      let next = src;
      const notes: string[] = [];
      if (!src.includes('@quiesco/agent')) {
        next = `import '@quiesco/agent'; // first: Quiesco hooks into React before the app loads\n${src}`;
        notes.push("added import '@quiesco/agent' as the first line");
      }
      // Issue #20: registerRootComponent(App) with a local App (the blank templates): wrap it here.
      const wrapped = wrapRegisteredRoot(ctx, entry, next);
      if (wrapped !== null) {
        next = wrapped;
        notes.push(`wrapped ${registeredRoot(ctx, entry, src)?.name ?? 'the root component'} in <QuiescoRoot>`);
      }
      if (next === src) {
        steps.push({ status: 'skipped', what: path.basename(entry), note: 'already imports @quiesco/agent' });
      } else {
        ctx.writeFile(entry, next);
        steps.push({ status: 'updated', what: path.basename(entry), note: notes.join('; ') });
      }
    }
  }

  // 5. quiesco.config.mts (.mts: an ES module whatever package.json says), cucumber config, features.
  const write = (rel: string, content: string, note: string, alternatives: readonly string[] = [rel]): void => {
    const existing = alternatives.find((f) => ctx.exists(path.join(ctx.cwd, f)));
    if (existing !== undefined) {
      steps.push({ status: 'skipped', what: existing, note: 'already exists' });
      return;
    }
    ctx.writeFile(path.join(ctx.cwd, rel), content);
    steps.push({ status: 'created', what: rel, note });
  };
  write('quiesco.config.mts', quiescoConfig(appWithIds, platforms), `apps: ${platforms.join(', ')}`, ['quiesco.config.ts', 'quiesco.config.mts', 'quiesco.config.js', 'quiesco.config.mjs']);
  write('cucumber.mjs', CUCUMBER_CONFIG, 'step files and format (features/**/*.feature by default)', ['cucumber.mjs', 'cucumber.js', 'cucumber.cjs', 'cucumber.json', 'cucumber.yaml', 'cucumber.yml']);
  write('features/package.json', '{ "type": "module" }\n', 'step files are ES modules');
  write('features/support/quiesco.ts', SUPPORT, 'this.app and the lifecycle hooks');
  write('features/app.feature', FEATURE, 'a first scenario');
  write('features/step_definitions/app.steps.ts', STEPS, 'its step');

  // 5b. tsconfig.json (issue #21): step files import each other with .ts (Node's type stripping needs it).
  ensureTsconfig(log);

  // 6. Scripts.
  ensureScripts(log, platforms);

  printSteps(ctx, steps);
  ctx.out('');
  ctx.out('Next:');
  const next: string[] = [];
  const finalMain = (readJson<PackageJson>(ctx, pkgFile) as PackageJson).main;
  if (!rootSourceFiles(ctx, finalMain).some((f) => (ctx.readFile(f) ?? '').includes('QuiescoRoot'))) {
    next.push("Wrap the root layout in <QuiescoRoot> (import { QuiescoRoot } from '@quiesco/agent'): the app connects to Quiesco from it, and the soft reset remounts it.");
  }
  next.push('Give the home screen testID="home" (features/step_definitions/app.steps.ts looks for it).');
  if (platforms.includes('web')) next.push('npx playwright install chromium, then npm run e2e:web');
  next.forEach((line, i) => ctx.out(`  ${i + 1}. ${line}`));
  if (platforms.some((p) => p !== 'web')) ctx.out('  •  iOS / Android: npm run e2e:build:ios (or :android) builds the app into binaryPath, then npm run e2e:ios; quiesco test starts Metro when it is not running. `npx quiesco doctor` checks the setup.');
  ctx.out('  •  A SYNC_TIMEOUT that names a decorative animation (the default template spins a glow): give it a testID and add it to sync.ignoreElements.');
  return 0;
}
