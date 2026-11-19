/**
 * `quiesco build ios|android [--force]` (issue #5): the e2e build of the app, written where the config's
 * `binaryPath` says, so `quiesco test` finds it. `expo prebuild` with EXPO_PUBLIC_QUIESCO=1, then
 * - iOS: `xcodebuild` for the simulator, with the derived data path, configuration and scheme read from
 *   `apps.ios.binaryPath` (`<derivedData>/Build/Products/<Configuration>-iphonesimulator/<Name>.app`);
 * - Android: `gradlew assemble<Variant>` (debug / release from `apps.android.binaryPath`), the APK copied to
 *   `binaryPath` when that is somewhere else.
 * A Debug build is skipped when its native inputs (app config, dependencies and their installed versions)
 * did not change since the last build and the binary is still there; `--force` builds anyway. Release builds
 * embed the JS bundle, so they are always built.
 * With `appDir` (or `--app-dir`, issue #54) the app is built in that directory; `binaryPath` stays relative
 * to the working directory (the config's).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { QuiescoConfig } from '@quiesco/core';
import { loadConfig } from '@quiesco/core';

import { APP_DIR_OPTION, appContext } from '../app-dir.js';
import type { CliContext } from '../context.js';
import { takeOption } from '../context.js';

export const BUILD_HELP = `Usage: quiesco build ios|android [--force] [--app-dir <dir>]

Builds the app for e2e tests (EXPO_PUBLIC_QUIESCO=1: expo prebuild, then xcodebuild / gradle) and writes it
to apps.<platform>.binaryPath in quiesco.config. A Debug build is skipped when the native inputs (app config,
dependencies) did not change since the last one; --force builds anyway. The app is the one in appDir
(quiesco.config) or --app-dir when the tests are in a package of their own.`;

export interface BuildDeps {
  loadConfig: (cwd: string) => Promise<QuiescoConfig>;
}

const defaultBuildDeps: BuildDeps = {
  loadConfig: async (cwd) => (await loadConfig({ cwd, worker: { workerIndex: 0, workerCount: 1 } })).config,
};

/** What `apps.ios.binaryPath` says about the xcodebuild that produces it, or null when it is not such a path. */
export function iosBuildTarget(binaryPath: string): { derivedData: string; configuration: string; name: string } | null {
  const m = /^(.*?)[\\/]Build[\\/]Products[\\/]([^\\/]+)-iphonesimulator[\\/]([^\\/]+)\.app[\\/]?$/.exec(binaryPath);
  if (m === null) return null;
  return { derivedData: m[1] as string, configuration: m[2] as string, name: m[3] as string };
}

/** The gradle variant for `apps.android.binaryPath`: release when the path says so, else debug. */
export function androidVariant(binaryPath: string): 'debug' | 'release' {
  return /(^|[\\/_-])release([\\/_.-]|$)/i.test(binaryPath) ? 'release' : 'debug';
}

const APP_CONFIGS = ['app.json', 'app.config.js', 'app.config.ts', 'app.config.mjs', 'app.config.cjs'];

/**
 * A hash of what goes into the native project: the app config files, and every dependency with its
 * installed version (a native module upgrade changes the build; JS-only ones only cost a rebuild).
 */
export function nativeFingerprint(ctx: CliContext, platform: 'ios' | 'android', binaryPath: string): string {
  const h = createHash('sha256');
  h.update(`${platform}\n${binaryPath}\n`);
  for (const f of APP_CONFIGS) {
    const text = ctx.readFile(path.join(ctx.cwd, f));
    if (text !== null) h.update(`${f}\n${text}\n`);
  }
  const pkg = JSON.parse(ctx.readFile(path.join(ctx.cwd, 'package.json')) ?? '{}') as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  for (const name of Object.keys(deps).sort()) {
    const installed = ctx.readFile(path.join(ctx.cwd, 'node_modules', name, 'package.json'));
    const version = installed === null ? '' : ((JSON.parse(installed) as { version?: string }).version ?? '');
    h.update(`${name}@${deps[name] ?? ''}=${version}\n`);
  }
  return h.digest('hex').slice(0, 16);
}

export async function buildCommand(args: readonly string[], ctx: CliContext, deps: BuildDeps = defaultBuildDeps): Promise<number> {
  if (args.includes('-h') || args.includes('--help')) {
    ctx.out(BUILD_HELP);
    return 0;
  }
  const force = args.includes('--force');
  const appDirOpt = takeOption(args.filter((a) => a !== '--force'), APP_DIR_OPTION);
  const rest = takeOption(appDirOpt.rest, '--platform');
  const platform = rest.value ?? rest.rest[0];
  if (platform !== 'ios' && platform !== 'android') {
    ctx.err(`quiesco build: choose ios or android (quiesco build ios). The web needs no build: quiesco test starts Metro, or export it with EXPO_PUBLIC_QUIESCO=1 npx expo export --platform web.`);
    return 2;
  }
  let config: QuiescoConfig;
  try {
    config = await deps.loadConfig(ctx.cwd);
  } catch (e) {
    ctx.err(`quiesco build: ${(e as Error).message}`);
    return 1;
  }
  const app = appContext(ctx, config, appDirOpt.value);
  const binaryPath = config.apps[platform]?.binaryPath;
  if (binaryPath === undefined) {
    ctx.err(`quiesco build: apps.${platform}.binaryPath is not set in quiesco.config: that is where the build goes (npx quiesco init writes it).`);
    return 2;
  }
  const ios = platform === 'ios' ? iosBuildTarget(binaryPath) : null;
  if (platform === 'ios' && ios === null) {
    ctx.err(`quiesco build: apps.ios.binaryPath must look like <dir>/Build/Products/Debug-iphonesimulator/<Name>.app (xcodebuild -derivedDataPath <dir>); it is ${binaryPath}`);
    return 2;
  }
  const release = platform === 'ios' ? !/^debug$/i.test(ios?.configuration ?? '') : androidVariant(binaryPath) === 'release';
  const binary = path.resolve(ctx.cwd, binaryPath);
  const stampFile = path.join(app.cwd, '.expo', 'quiesco', `build-${platform}.json`);
  const fingerprint = nativeFingerprint(app, platform, binaryPath);
  if (!force && !release && ctx.exists(binary)) {
    const stamp = ctx.readFile(stampFile);
    if (stamp !== null && (JSON.parse(stamp) as { fingerprint?: string }).fingerprint === fingerprint) {
      ctx.out(`quiesco build: ${binaryPath} is up to date (the app config and dependencies did not change; --force builds anyway).`);
      return 0;
    }
  }

  const env = { ...ctx.env, EXPO_PUBLIC_QUIESCO: '1' };
  ctx.out(`quiesco build: expo prebuild --platform ${platform} (EXPO_PUBLIC_QUIESCO=1)`);
  if (app !== ctx) ctx.out(`quiesco build: the app in ${app.cwd}`);
  let code = await ctx.run('npx', ['expo', 'prebuild', '--platform', platform], { cwd: app.cwd, env });
  if (code !== 0) return fail(ctx, 'expo prebuild', code);

  if (ios !== null) {
    const workspace = path.join('ios', `${ios.name}.xcworkspace`);
    if (!app.exists(path.join(app.cwd, workspace))) {
      ctx.err(`quiesco build: ${workspace} not found after prebuild. The .app name in apps.ios.binaryPath must be the Xcode scheme (expo prebuild names it after expo.name).`);
      return 1;
    }
    // binaryPath (and so the derived data) is relative to the working directory; xcodebuild runs in the app.
    const derivedData = path.relative(app.cwd, path.resolve(ctx.cwd, ios.derivedData)) || '.';
    const xcode = ['-workspace', workspace, '-scheme', ios.name, '-configuration', ios.configuration, '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', derivedData, '-quiet', 'build'];
    ctx.out(`quiesco build: xcodebuild ${xcode.join(' ')}`);
    code = await ctx.run('xcodebuild', xcode, { cwd: app.cwd, env });
    if (code !== 0) return fail(ctx, 'xcodebuild', code);
  } else {
    const variant = androidVariant(binaryPath);
    const task = `assemble${variant === 'release' ? 'Release' : 'Debug'}`;
    const gradlew = ctx.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    ctx.out(`quiesco build: ${gradlew} ${task} (in android/)`);
    code = await ctx.run(gradlew, [task], { cwd: path.join(app.cwd, 'android'), env });
    if (code !== 0) return fail(ctx, `gradle ${task}`, code);
    const output = path.join(app.cwd, 'android', 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`);
    if (path.resolve(output) !== binary) {
      fs.mkdirSync(path.dirname(binary), { recursive: true });
      fs.copyFileSync(output, binary);
    }
  }
  if (!ctx.exists(binary)) {
    ctx.err(`quiesco build: the build finished but ${binaryPath} is not there; check apps.${platform}.binaryPath.`);
    return 1;
  }
  ctx.writeFile(stampFile, `${JSON.stringify({ fingerprint, binaryPath, builtAt: new Date().toISOString() }, null, 2)}\n`);
  ctx.out(`quiesco build: ${binaryPath} is ready.`);
  return 0;
}

function fail(ctx: CliContext, step: string, code: number): number {
  ctx.err(`quiesco build: ${step} failed (exit code ${code}).`);
  return code === 0 ? 1 : code;
}
