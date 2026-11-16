/**
 * `quiesco doctor [--platform ios|android|web]` (requirements.md §6.12): check the environment and the
 * project's Quiesco setup. Every check says what is wrong and how to fix it; exit code 1 when a check
 * fails (warnings do not fail).
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import type { QuiescoConfig } from '@quiesco/core';
import { loadConfig, serverPort } from '@quiesco/core';

import type { CliContext, CliPlatform } from '../context.js';
import { PLATFORMS, parsePlatform, takeOption } from '../context.js';
import { MIN_EXPO_SDK, UPGRADE_SDK_FIX, expoSdk } from '../expo-sdk.js';
import { CLI_COMMANDS, installedVersion, isQuiescoPackage, scriptCommands } from '../packages.js';
import { rootSourceFiles } from '../project.js';

/** `info`: worth knowing, nothing is wrong (counted neither as a warning nor as a failure). */
export type CheckStatus = 'ok' | 'info' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface DoctorDeps {
  loadConfig: (cwd: string) => Promise<QuiescoConfig>;
  portFree: (port: number) => Promise<boolean>;
}

const MIN_NODE_MAJOR = 24;
const ICON: Record<CheckStatus, string> = { ok: '✅', info: 'ℹ️ ', warn: '⚠️ ', fail: '❌' };
/** How the fixes for older setups end (issues #34, #35). */
const UPGRADE_HINT = 'npx quiesco@latest init --upgrade fixes this';

interface PackageJson {
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
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

function hasDep(pkg: PackageJson, name: string): boolean {
  return pkg.dependencies?.[name] !== undefined || pkg.devDependencies?.[name] !== undefined;
}

/** The entry module's first import / require target, ignoring comments. */
export function firstImport(source: string): string | null {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const m = /(?:^|\n)\s*(?:import\s+(?:[^'"]*?\s+from\s+)?|(?:const|let|var)\s+[^=]+=\s*require\(|require\()\s*['"]([^'"]+)['"]/.exec(stripped);
  return m?.[1] ?? null;
}

function androidTool(ctx: CliContext, rel: string, name: string): string {
  const home = ctx.env['ANDROID_HOME'] ?? ctx.env['ANDROID_SDK_ROOT'];
  if (home !== undefined) {
    const p = path.join(home, rel);
    if (ctx.exists(p)) return p;
  }
  return name;
}

function expoCheck(ctx: CliContext, pkg: PackageJson): CheckResult {
  if (!hasDep(pkg, 'expo')) return { name: 'Expo project', status: 'fail', detail: 'expo is not a dependency', fix: 'Quiesco tests Expo apps; run it in one (npx create-expo-app).' };
  const declared = pkg.dependencies?.['expo'] ?? pkg.devDependencies?.['expo'];
  const sdk = expoSdk(ctx, declared);
  if (sdk === null) return { name: 'Expo project', status: 'ok', detail: `expo ${declared ?? ''}` };
  const detail = `expo ${sdk.version} (SDK ${sdk.sdk}${sdk.installed ? '' : ', not installed'})`;
  return sdk.sdk >= MIN_EXPO_SDK ? { name: 'Expo project', status: 'ok', detail } : { name: 'Expo project', status: 'fail', detail, fix: UPGRADE_SDK_FIX };
}

function projectChecks(ctx: CliContext): CheckResult[] {
  const results: CheckResult[] = [];
  const pkg = readJson<PackageJson>(ctx, path.join(ctx.cwd, 'package.json'));
  if (pkg === null) {
    return [{ name: 'project', status: 'fail', detail: `no package.json in ${ctx.cwd}`, fix: 'Run quiesco in the Expo app directory.' }];
  }
  results.push(expoCheck(ctx, pkg));
  const missing = ['@quiesco/agent', '@quiesco/cucumber', '@cucumber/cucumber'].filter((d) => !hasDep(pkg, d));
  results.push(
    missing.length === 0
      ? { name: 'Quiesco packages', status: 'ok', detail: '@quiesco/agent, @quiesco/cucumber, @cucumber/cucumber' }
      : { name: 'Quiesco packages', status: 'fail', detail: `missing ${missing.join(', ')}`, fix: 'Run `npx quiesco init`, or install them.' },
  );

  results.push(...versionChecks(ctx, pkg));
  results.push(...legacyChecks(ctx));

  const appJson = readJson<{ expo?: { plugins?: unknown[] } }>(ctx, path.join(ctx.cwd, 'app.json'));
  const plugins = appJson?.expo?.plugins ?? [];
  const listed = plugins.some((p) => p === '@quiesco/expo-plugin' || (Array.isArray(p) && p[0] === '@quiesco/expo-plugin'));
  const dynamic = ['app.config.ts', 'app.config.js', 'app.config.mjs'].some((f) => ctx.exists(path.join(ctx.cwd, f)));
  results.push(
    listed
      ? { name: 'config plugin', status: 'ok', detail: '@quiesco/expo-plugin in app.json' }
      : dynamic
        ? { name: 'config plugin', status: 'warn', detail: 'app.config.* found; cannot check its plugins', fix: 'Make sure "@quiesco/expo-plugin" is in plugins (native e2e builds need it).' }
        : { name: 'config plugin', status: 'warn', detail: '@quiesco/expo-plugin is not in app.json plugins', fix: 'Add "@quiesco/expo-plugin" to expo.plugins (needed for iOS / Android e2e builds, not for web).' },
  );

  const metro = ['metro.config.js', 'metro.config.cjs', 'metro.config.mjs', 'metro.config.ts'].map((f) => path.join(ctx.cwd, f)).find((f) => ctx.exists(f));
  const metroSrc = metro !== undefined ? ctx.readFile(metro) : null;
  results.push(
    metroSrc !== null && metroSrc.includes('withQuiesco')
      ? { name: 'Metro', status: 'ok', detail: `${path.basename(metro as string)} uses withQuiesco()` }
      : {
          name: 'Metro',
          status: 'fail',
          detail: metro === undefined ? 'no metro.config.js' : `${path.basename(metro)} does not use withQuiesco()`,
          fix: "Wrap the config: module.exports = withQuiesco(getDefaultConfig(__dirname)) with const { withQuiesco } = require('@quiesco/agent/metro'). Without it production bundles keep the agent and e2e bundles start it too late.",
        },
  );

  const main = pkg.main;
  if (main === undefined || /(^|\/)expo-router\/entry$/.test(main) || main === 'expo/AppEntry') {
    results.push({
      name: 'entry file',
      status: 'fail',
      detail: main === undefined ? 'package.json has no "main"' : `"main" is ${main}`,
      fix: "Create index.ts with `import '@quiesco/agent';` as the first line followed by the original entry (e.g. `import 'expo-router/entry';`), and set \"main\": \"index.ts\".",
    });
  } else {
    const entry = [main, `${main}.ts`, `${main}.tsx`, `${main}.js`].map((f) => path.join(ctx.cwd, f)).find((f) => ctx.exists(f));
    const src = entry !== undefined ? ctx.readFile(entry) : null;
    const first = src !== null ? firstImport(src) : null;
    results.push(
      first === '@quiesco/agent'
        ? { name: 'entry file', status: 'ok', detail: `${main} imports @quiesco/agent first` }
        : src !== null && src.includes('@quiesco/agent')
          ? { name: 'entry file', status: 'warn', detail: `${main} imports @quiesco/agent, but not first`, fix: "Move `import '@quiesco/agent';` to the first line, before anything that loads React Native." }
          : { name: 'entry file', status: 'fail', detail: `${main} does not import @quiesco/agent`, fix: "Add `import '@quiesco/agent';` as its first line." },
    );
  }
  return results;
}

/**
 * Issue #17: every Quiesco package in package.json is installed at one version, and every `quiesco <cmd>`
 * in the scripts exists in it.
 */
function versionChecks(ctx: CliContext, pkg: PackageJson): CheckResult[] {
  const results: CheckResult[] = [];
  const names = [...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])].filter(isQuiescoPackage).sort();
  if (names.length === 0) return results;
  const installed = names.map((name) => ({ name, version: installedVersion(ctx, name) }));
  const missing = installed.filter((p) => p.version === null).map((p) => p.name);
  const versions = [...new Set(installed.flatMap((p) => (p.version !== null ? [p.version] : [])))];
  const list = installed.map((p) => `${p.name} ${p.version ?? '(not installed)'}`).join(', ');
  let project: string | undefined;
  if (missing.length > 0) {
    results.push({ name: 'Quiesco versions', status: 'fail', detail: `not installed: ${missing.join(', ')}`, fix: 'Install the dependencies (npm install / pnpm install).' });
  } else if (versions.length > 1) {
    const newest = [...versions].sort(compareVersions).at(-1) as string;
    results.push({
      name: 'Quiesco versions',
      status: 'fail',
      detail: `different versions: ${list}`,
      fix: `Quiesco's packages are released together and only work with the same version. Install one version of all of them, e.g. ${names.map((n) => `${n}@${newest}`).join(' ')}, or upgrade them all with npx quiesco@latest init --upgrade.`,
    });
  } else {
    project = versions[0] as string;
    results.push(
      project === ctx.version
        ? { name: 'Quiesco versions', status: 'ok', detail: `${names.length} packages at ${project}` }
        : {
            name: 'Quiesco versions',
            status: 'warn',
            detail: `the project has ${project}; this doctor is ${ctx.version}`,
            fix: "Run the project's own CLI (npx quiesco doctor in the project directory), or upgrade the project with npx quiesco@latest init --upgrade.",
          },
    );
  }
  const unknown = scriptCommands(pkg.scripts).filter((c) => !(CLI_COMMANDS as readonly string[]).includes(c.command));
  if (unknown.length > 0) {
    results.push({
      name: 'scripts',
      status: 'fail',
      detail: unknown.map((c) => `"${c.script}" runs \`quiesco ${c.command}\``).join(', '),
      fix: `quiesco ${ctx.version} has no such command (it has ${CLI_COMMANDS.join(', ')}). ${project !== undefined && project !== ctx.version ? `The project has Quiesco ${project}; upgrade it, or ` : ''}Fix the script.`,
    });
  }
  return results;
}

const CUCUMBER_FILES = ['cucumber.mjs', 'cucumber.js', 'cucumber.cjs', 'cucumber.json', 'cucumber.yaml', 'cucumber.yml'];
const CONFIG_FILES = ['quiesco.config.mts', 'quiesco.config.ts', 'quiesco.config.mjs', 'quiesco.config.js'];
const DYNAMIC_APP_CONFIGS = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs'];

/** The first step / support file under features/ that imports a relative .ts file, or null. */
function tsImport(ctx: CliContext): string | null {
  const dir = path.join(ctx.cwd, 'features');
  let files: string[];
  try {
    files = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.[cm]?tsx?$/.test(f) && !f.split(path.sep).includes('node_modules'));
  } catch {
    return null;
  }
  const relTs = /(?:from\s+|import\s*\(?\s*)['"]\.{1,2}\/[^'"]+\.[cm]?tsx?['"]/;
  return files.find((f) => relTs.test(ctx.readFile(path.join(dir, f)) ?? '')) ?? null;
}

/**
 * Issue #35: files written by older inits that the current one writes differently. Reported only when
 * something is wrong.
 */
function legacyChecks(ctx: CliContext): CheckResult[] {
  const results: CheckResult[] = [];
  const cucumber = CUCUMBER_FILES.find((f) => ctx.exists(path.join(ctx.cwd, f)));
  if (cucumber !== undefined && /\bpaths\b["']?\s*:/.test(ctx.readFile(path.join(ctx.cwd, cucumber)) ?? '')) {
    results.push({
      name: 'cucumber paths',
      status: 'warn',
      detail: `${cucumber} sets paths`,
      fix: `cucumber-js adds them to the files given on the command line, so quiesco test features/x.feature runs every feature. Remove the line (features/**/*.feature is the default); ${UPGRADE_HINT}.`,
    });
  }
  const tsconfig = ctx.readFile(path.join(ctx.cwd, 'tsconfig.json'));
  if (tsconfig !== null && !/"allowImportingTsExtensions"\s*:\s*true/.test(tsconfig)) {
    const importer = tsImport(ctx);
    if (importer !== null) {
      results.push({
        name: 'tsconfig',
        status: 'fail',
        detail: `features/${importer} imports a .ts file, and tsconfig.json does not set allowImportingTsExtensions`,
        fix: `Add "allowImportingTsExtensions": true to compilerOptions: tsc fails with TS5097 without it (step files must name the .ts file for Node's type stripping); ${UPGRADE_HINT}.`,
      });
    }
  }
  return results;
}

/** e2e builds have a script for each native platform in the config (older inits did not write them). */
function buildScriptChecks(pkg: PackageJson | null, config: QuiescoConfig): CheckResult[] {
  const scripts = Object.values(pkg?.scripts ?? {});
  return (['ios', 'android'] as const)
    .filter((p) => config.apps[p] !== undefined && !scripts.some((s) => new RegExp(`\\bquiesco build ${p}\\b`).test(s)))
    .map((p) => ({
      name: 'build scripts',
      status: 'info' as const,
      detail: `no script runs quiesco build ${p}`,
      fix: `Add "e2e:build:${p}": "quiesco build ${p}" to package.json (or run npx quiesco build ${p}); ${UPGRADE_HINT}.`,
    }));
}

interface AppJsonIds {
  expo?: { scheme?: string | string[]; ios?: { bundleIdentifier?: string }; android?: { package?: string } };
}

/**
 * Issue #34: quiesco.config names the app that the build makes. Compared with app.json (what expo prebuild
 * uses) and, when they exist, with the prebuilt Android project and the iOS build. Placeholders left by
 * init fail.
 */
async function appIdChecks(ctx: CliContext, config: QuiescoConfig): Promise<CheckResult[]> {
  const { ios, android } = config.apps;
  if (ios === undefined && android === undefined) return [];
  const configFile = CONFIG_FILES.find((f) => ctx.exists(path.join(ctx.cwd, f)));
  const todos = [...((configFile !== undefined ? ctx.readFile(path.join(ctx.cwd, configFile)) : null) ?? '').matchAll(/\/\/ TODO: (expo\.[\w.]+)/g)].map((m) => m[1] as string);
  if (todos.length > 0) {
    return [
      {
        name: 'app IDs',
        status: 'fail',
        detail: `${configFile as string} still has init's placeholders (TODO: ${todos.join(', ')})`,
        fix: `Set the IDs in app.json (expo.ios.bundleIdentifier, expo.android.package, expo.scheme) and the same values in quiesco.config; ${UPGRADE_HINT}.`,
      },
    ];
  }
  const dynamic = DYNAMIC_APP_CONFIGS.find((f) => ctx.exists(path.join(ctx.cwd, f)));
  const results: CheckResult[] = [];
  if (dynamic !== undefined) {
    results.push({ name: 'app IDs', status: 'warn', detail: `${dynamic} found; cannot compare the app IDs with it`, fix: 'Make sure apps.ios.bundleId, apps.android.package and devClient.scheme are the values your app config sets.' });
  } else {
    const expo = readJson<AppJsonIds>(ctx, path.join(ctx.cwd, 'app.json'))?.expo ?? {};
    const schemes = expo.scheme === undefined ? [] : Array.isArray(expo.scheme) ? expo.scheme : [expo.scheme];
    const problems: string[] = [];
    const compare = (what: string, want: string, have: string | undefined): void => {
      if (have === undefined) problems.push(`app.json has no expo.${what} (the build gets Expo's default, not ${want})`);
      else if (have !== want) problems.push(`quiesco.config has ${want}, app.json expo.${what} is ${have}`);
    };
    if (ios !== undefined) compare('ios.bundleIdentifier', ios.bundleId, expo.ios?.bundleIdentifier);
    if (android !== undefined) compare('android.package', android.package, expo.android?.package);
    const scheme = android?.devClient?.scheme;
    if (scheme !== undefined && !schemes.includes(scheme)) {
      problems.push(schemes.length === 0 ? `app.json has no expo.scheme (the dev client cannot be opened with ${scheme}://)` : `devClient.scheme is ${scheme}, app.json expo.scheme is ${schemes.join(', ')}`);
    }
    results.push(
      problems.length === 0
        ? { name: 'app IDs', status: 'ok', detail: 'quiesco.config matches app.json' }
        : { name: 'app IDs', status: 'fail', detail: problems.join('; '), fix: 'Use the same IDs in app.json and quiesco.config, then build again (npx quiesco build ios / android).' },
    );
  }
  // The builds: an app built before the IDs changed is another app.
  if (android !== undefined) {
    const gradle = ctx.readFile(path.join(ctx.cwd, 'android/app/build.gradle'));
    const built = gradle === null ? undefined : /applicationId\s*(?:=\s*)?['"]([^'"]+)['"]/.exec(gradle)?.[1];
    const manifest = ctx.readFile(path.join(ctx.cwd, 'android/app/src/main/AndroidManifest.xml'));
    const scheme = android.devClient?.scheme;
    const wrong: string[] = [];
    if (built !== undefined && built !== android.package) wrong.push(`android/app/build.gradle has applicationId ${built}`);
    if (scheme !== undefined && manifest !== null && !manifest.includes(`android:scheme="${scheme}"`)) wrong.push(`AndroidManifest.xml registers no ${scheme}:// scheme`);
    if (wrong.length > 0) {
      results.push({ name: 'Android: app ID', status: 'fail', detail: `${wrong.join('; ')} (quiesco.config: ${android.package}${scheme !== undefined ? `, ${scheme}://` : ''})`, fix: 'Build again once app.json has the IDs quiesco.config names: npx quiesco build android (it runs expo prebuild with app.json).' });
    }
  }
  if (ios?.binaryPath !== undefined && ctx.platform === 'darwin') {
    const plist = path.join(path.resolve(ctx.cwd, ios.binaryPath), 'Info.plist');
    if (ctx.exists(plist)) {
      const r = await ctx.exec('plutil', ['-extract', 'CFBundleIdentifier', 'raw', plist]);
      const built = r.code === 0 ? r.stdout.trim() : '';
      if (built !== '' && built !== ios.bundleId) {
        results.push({ name: 'iOS: app ID', status: 'fail', detail: `${ios.binaryPath} is ${built} (quiesco.config: ${ios.bundleId})`, fix: 'Build again once app.json has the ID quiesco.config names: npx quiesco build ios.' });
      }
    }
  }
  return results;
}

/** Numeric semver order (prerelease tags compare as text). */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const d = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Issue #20: the agent connects from <QuiescoRoot> and the soft reset remounts the app through it, so a
 * missing one fails (CONNECT_TIMEOUT on every run) whatever the reset mode.
 */
function rootCheck(ctx: CliContext, main: string | undefined): CheckResult {
  const files = rootSourceFiles(ctx, main);
  const found = files.find((f) => (ctx.readFile(f) ?? '').includes('QuiescoRoot'));
  const rel = (f: string): string => path.relative(ctx.cwd, f);
  return found !== undefined
    ? { name: '<QuiescoRoot>', status: 'ok', detail: `in ${rel(found)}` }
    : {
        name: '<QuiescoRoot>',
        status: 'fail',
        detail: `not found in ${files.length > 0 ? files.map(rel).join(', ') : 'app/_layout, src/app/_layout, App or the entry file'}`,
        fix: "Wrap the app's root in it: import { QuiescoRoot } from '@quiesco/agent'; <QuiescoRoot>…</QuiescoRoot> (the root layout, or the component the entry registers). The app connects to Quiesco from it, and the soft reset before each scenario remounts the app through it: without it no test can run.",
      };
}

async function platformChecks(ctx: CliContext, platform: CliPlatform, config: QuiescoConfig | null): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const abs = (p: string) => path.resolve(ctx.cwd, p);
  if (platform === 'ios') {
    if (ctx.platform !== 'darwin') return [{ name: 'iOS', status: 'fail', detail: `iOS simulators need macOS (this is ${ctx.platform})` }];
    const list = await ctx.exec('xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
    if (list.code !== 0) {
      out.push({ name: 'iOS: simctl', status: 'fail', detail: 'xcrun simctl is not available', fix: 'Install Xcode and run `sudo xcode-select -s /Applications/Xcode.app` once.' });
    } else {
      let count = 0;
      let booted = 0;
      try {
        const devices = (JSON.parse(list.stdout) as { devices: Record<string, { state: string; name: string }[]> }).devices;
        for (const [runtime, ds] of Object.entries(devices)) {
          if (!runtime.includes('iOS')) continue;
          count += ds.length;
          booted += ds.filter((d) => d.state === 'Booted').length;
        }
      } catch {
        // counted as none
      }
      out.push(
        count > 0
          ? { name: 'iOS: simulators', status: 'ok', detail: `${count} available, ${booted} booted` }
          : { name: 'iOS: simulators', status: 'fail', detail: 'no iOS simulator available', fix: 'Install an iOS runtime in Xcode › Settings › Components.' },
      );
    }
    const bin = config?.apps.ios?.binaryPath;
    if (bin !== undefined) {
      out.push(
        ctx.exists(abs(bin))
          ? { name: 'iOS: app build', status: 'ok', detail: bin }
          : { name: 'iOS: app build', status: 'warn', detail: `${bin} not found`, fix: 'npx quiesco build ios (or an EAS e2e build made with EXPO_PUBLIC_QUIESCO=1).' },
      );
    }
  }
  if (platform === 'android') {
    const adb = androidTool(ctx, 'platform-tools/adb', 'adb');
    const version = await ctx.exec(adb, ['version']);
    if (version.code !== 0) {
      out.push({ name: 'Android: adb', status: 'fail', detail: 'adb not found', fix: 'Install the Android SDK platform-tools and set ANDROID_HOME.' });
    } else {
      out.push({ name: 'Android: adb', status: 'ok', detail: adb });
      const devices = await ctx.exec(adb, ['devices']);
      const online = devices.stdout.split('\n').filter((l) => /\tdevice$/.test(l)).length;
      const avds = await ctx.exec(androidTool(ctx, 'emulator/emulator', 'emulator'), ['-list-avds']);
      const avdNames = avds.code === 0 ? avds.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('INFO')) : [];
      out.push(
        online > 0 || avdNames.length > 0
          ? { name: 'Android: devices', status: 'ok', detail: `${online} online, AVDs: ${avdNames.join(', ') || 'none'}` }
          : { name: 'Android: devices', status: 'fail', detail: 'no device online and no AVD', fix: 'Create an emulator in Android Studio › Device Manager (or start a device).' },
      );
    }
    const bin = config?.apps.android?.binaryPath;
    if (bin !== undefined) {
      out.push(
        ctx.exists(abs(bin))
          ? { name: 'Android: app build', status: 'ok', detail: bin }
          : { name: 'Android: app build', status: 'warn', detail: `${bin} not found`, fix: 'npx quiesco build android (or an EAS e2e build made with EXPO_PUBLIC_QUIESCO=1).' },
      );
    }
  }
  if (platform === 'web') {
    const probe = await ctx.exec(
      'node',
      ['--input-type=module', '-e', "const { chromium } = await import('playwright'); await import('@quiesco/web'); console.log(chromium.executablePath());"],
      { cwd: ctx.cwd },
    );
    if (probe.code !== 0) {
      out.push({ name: 'Web: packages', status: 'fail', detail: 'playwright or @quiesco/web cannot be loaded', fix: 'Install them: npm i -D @quiesco/web playwright' });
    } else {
      const exe = probe.stdout.trim();
      out.push(
        ctx.exists(exe)
          ? { name: 'Web: Chromium', status: 'ok', detail: exe }
          : { name: 'Web: Chromium', status: 'fail', detail: 'Playwright Chromium is not installed', fix: 'npx playwright install chromium' },
      );
    }
    const dist = config?.apps.web?.distDir;
    if (dist !== undefined) {
      out.push(
        ctx.exists(abs(dist))
          ? { name: 'Web: export', status: 'ok', detail: dist }
          : { name: 'Web: export', status: 'warn', detail: `${dist} not found`, fix: 'Export it with EXPO_PUBLIC_QUIESCO=1 npx expo export --platform web.' },
      );
    }
  }
  return out;
}

export const defaultDoctorDeps: DoctorDeps = {
  loadConfig: async (cwd) => (await loadConfig({ cwd })).config,
  portFree: (port) =>
    new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, () => srv.close(() => resolve(true)));
    }),
};

export async function runChecks(ctx: CliContext, only: CliPlatform | undefined, deps: DoctorDeps = defaultDoctorDeps): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const major = Number.parseInt(ctx.nodeVersion, 10);
  results.push(
    major >= MIN_NODE_MAJOR
      ? { name: 'Node.js', status: 'ok', detail: `v${ctx.nodeVersion}` }
      : { name: 'Node.js', status: 'fail', detail: `v${ctx.nodeVersion}`, fix: `Quiesco needs Node.js ${MIN_NODE_MAJOR} or later.` },
  );
  // Issue #3: Expo starts Metro without a file watcher when CI is set, so edits never reach the app.
  const ci = ctx.env['CI'];
  if (ctx.interactive && ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false') {
    results.push({
      name: 'CI',
      status: 'warn',
      detail: `CI=${ci} is set in this terminal`,
      fix: 'Metro started with CI set does not watch files, so code changes do not reach the app under test. Unset it (unset CI) before EXPO_PUBLIC_QUIESCO=1 npx expo start.',
    });
  }
  results.push(...projectChecks(ctx));
  results.push(rootCheck(ctx, readJson<PackageJson>(ctx, path.join(ctx.cwd, 'package.json'))?.main));

  let config: QuiescoConfig | null = null;
  try {
    config = await deps.loadConfig(ctx.cwd);
    results.push({ name: 'quiesco.config', status: 'ok', detail: `apps: ${Object.keys(config.apps).join(', ') || 'none'}` });
    results.push(...(await appIdChecks(ctx, config)));
    results.push(...buildScriptChecks(readJson<PackageJson>(ctx, path.join(ctx.cwd, 'package.json')), config));
  } catch (e) {
    results.push({ name: 'quiesco.config', status: 'fail', detail: (e as Error).message.split('\n')[0] ?? '', fix: 'Create quiesco.config.mts (npx quiesco init writes one).' });
  }

  const platforms = only !== undefined ? [only] : PLATFORMS.filter((p) => config?.apps[p] !== undefined);
  for (const p of platforms) results.push(...(await platformChecks(ctx, p, config)));

  if (config !== null) {
    const port = serverPort(config);
    results.push(
      (await deps.portFree(port))
        ? { name: 'port', status: 'ok', detail: `${port} is free` }
        : { name: 'port', status: 'warn', detail: `${port} is in use`, fix: 'Another test run (or quiesco tree) may be running; stop it or set server.port.' },
    );
  }
  return results;
}

export async function doctorCommand(args: readonly string[], ctx: CliContext, deps: DoctorDeps = defaultDoctorDeps): Promise<number> {
  const { value, rest } = takeOption(args, '--platform');
  if (rest.length > 0) {
    ctx.err(`quiesco doctor: unknown arguments ${rest.join(' ')}`);
    return 2;
  }
  const results = await runChecks(ctx, parsePlatform(value), deps);
  for (const r of results) {
    ctx.out(`${ICON[r.status]} ${r.name}: ${r.detail}`);
    if (r.fix !== undefined && r.status !== 'ok') ctx.out(`   → ${r.fix}`);
  }
  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  ctx.out('');
  ctx.out(failed === 0 ? `All required checks passed${warned > 0 ? ` (${warned} warning${warned > 1 ? 's' : ''})` : ''}.` : `${failed} check${failed > 1 ? 's' : ''} failed.`);
  return failed === 0 ? 0 : 1;
}
