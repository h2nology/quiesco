/**
 * `quiesco doctor [--platform ios|android|web]` (requirements.md §6.12): check the environment and the
 * project's Quiesco setup. Every check says what is wrong and how to fix it; exit code 1 when a check
 * fails (warnings do not fail).
 */
import net from 'node:net';
import path from 'node:path';

import type { QuiescoConfig } from '@quiesco/core';
import { loadConfig, serverPort } from '@quiesco/core';

import type { CliContext, CliPlatform } from '../context.js';
import { PLATFORMS, parsePlatform, takeOption } from '../context.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

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
const ICON: Record<CheckStatus, string> = { ok: '✅', warn: '⚠️ ', fail: '❌' };

interface PackageJson {
  main?: string;
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

function projectChecks(ctx: CliContext): CheckResult[] {
  const results: CheckResult[] = [];
  const pkg = readJson<PackageJson>(ctx, path.join(ctx.cwd, 'package.json'));
  if (pkg === null) {
    return [{ name: 'project', status: 'fail', detail: `no package.json in ${ctx.cwd}`, fix: 'Run quiesco in the Expo app directory.' }];
  }
  results.push(
    hasDep(pkg, 'expo')
      ? { name: 'Expo project', status: 'ok', detail: `expo ${pkg.dependencies?.['expo'] ?? pkg.devDependencies?.['expo'] ?? ''}` }
      : { name: 'Expo project', status: 'fail', detail: 'expo is not a dependency', fix: 'Quiesco tests Expo apps; run it in one (npx create-expo-app).' },
  );
  const missing = ['@quiesco/agent', '@quiesco/cucumber', '@cucumber/cucumber'].filter((d) => !hasDep(pkg, d));
  results.push(
    missing.length === 0
      ? { name: 'Quiesco packages', status: 'ok', detail: '@quiesco/agent, @quiesco/cucumber, @cucumber/cucumber' }
      : { name: 'Quiesco packages', status: 'fail', detail: `missing ${missing.join(', ')}`, fix: 'Run `npx quiesco init`, or install them.' },
  );

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

function rootCheck(ctx: CliContext, files: readonly string[]): CheckResult {
  const found = files.some((f) => (ctx.readFile(f) ?? '').includes('QuiescoRoot'));
  return found
    ? { name: '<QuiescoRoot>', status: 'ok', detail: 'used in the app' }
    : { name: '<QuiescoRoot>', status: 'warn', detail: 'not found in app/, src/ or the entry', fix: "Wrap the root layout: import { QuiescoRoot } from '@quiesco/agent'; <QuiescoRoot>…</QuiescoRoot>." };
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
          : { name: 'iOS: app build', status: 'warn', detail: `${bin} not found`, fix: 'Build it with EXPO_PUBLIC_QUIESCO=1 (prebuild + xcodebuild for the simulator, or an EAS e2e build).' },
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
          : { name: 'Android: app build', status: 'warn', detail: `${bin} not found`, fix: 'Build it with EXPO_PUBLIC_QUIESCO=1 (prebuild + gradlew assembleDebug, or an EAS e2e build).' },
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
  results.push(...projectChecks(ctx));
  const sources = ['app/_layout.tsx', 'src/app/_layout.tsx', 'App.tsx', 'App.js', 'src/App.tsx', 'app/_layout.js', 'src/app/_layout.js'].map((f) => path.join(ctx.cwd, f));
  results.push(rootCheck(ctx, sources));

  let config: QuiescoConfig | null = null;
  try {
    config = await deps.loadConfig(ctx.cwd);
    results.push({ name: 'quiesco.config', status: 'ok', detail: `apps: ${Object.keys(config.apps).join(', ') || 'none'}` });
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
