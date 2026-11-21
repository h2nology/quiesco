/**
 * Issue #54: tests in a package of their own (the working directory) and the Expo app elsewhere (appDir in
 * quiesco.config, or --app-dir): doctor, build, init --upgrade and the Metro the tests start.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { QuiescoConfig } from '@quiesco/core';

import { appContext } from '../src/app-dir';
import { buildCommand } from '../src/commands/build';
import { runChecks } from '../src/commands/doctor';
import type { CheckResult, DoctorDeps } from '../src/commands/doctor';
import { upgradeCommand } from '../src/commands/upgrade';
import type { BackgroundProcess } from '../src/context';
import { ensureDevServer } from '../src/dev-server';
import type { FakeContext } from './fake-context';
import { fakeContext } from './fake-context';

const ANDROID = { package: 'com.acme.shop', binaryPath: 'app/android/app/build/outputs/apk/debug/app-debug.apk' };

/** The test package (the working directory) with the app in app/, both set up, Quiesco 9.9.9 installed. */
function monorepo(ctx: FakeContext, versions: { app?: string; tests?: string } = {}): void {
  const app = versions.app ?? '9.9.9';
  const tests = versions.tests ?? '9.9.9';
  ctx.put(
    'app/package.json',
    JSON.stringify({ name: 'shop', main: 'index.ts', dependencies: { expo: '~58.0.23', '@quiesco/agent': app }, devDependencies: { '@quiesco/expo-plugin': app } }),
  );
  ctx.put('app/app.json', JSON.stringify({ expo: { name: 'shop', scheme: 'shop', android: { package: 'com.acme.shop' }, plugins: ['@quiesco/expo-plugin'] } }));
  ctx.put('app/metro.config.js', "const { withQuiesco } = require('@quiesco/agent/metro');\nmodule.exports = withQuiesco({});\n");
  ctx.put('app/index.ts', "import '@quiesco/agent';\nimport 'expo-router/entry';\n");
  ctx.put('app/src/app/_layout.tsx', "import { QuiescoRoot } from '@quiesco/agent';\n");
  for (const n of ['@quiesco/agent', '@quiesco/expo-plugin']) ctx.put(`app/node_modules/${n}/package.json`, JSON.stringify({ name: n, version: app }));
  ctx.put('app/node_modules/expo/package.json', JSON.stringify({ name: 'expo', version: '58.0.23' }));
  ctx.put('package.json', JSON.stringify({ name: 'e2e', scripts: { 'e2e:build:android': 'quiesco build android' }, devDependencies: { quiesco: tests, '@quiesco/core': tests, '@quiesco/vitest': tests, vitest: '^5.1.0' } }));
  for (const n of ['quiesco', '@quiesco/core', '@quiesco/vitest']) ctx.put(`node_modules/${n}/package.json`, JSON.stringify({ name: n, version: tests }));
  ctx.put('quiesco.config.mts', "export default { appDir: 'app', apps: { android: { package: 'com.acme.shop' } } };\n");
}

const config = (extra: Partial<QuiescoConfig> = {}): QuiescoConfig => ({ appDir: 'app', apps: { android: ANDROID }, ...extra });
const doctorDeps = (c: QuiescoConfig | Error): DoctorDeps => ({ loadConfig: async () => (c instanceof Error ? Promise.reject(c) : c), portFree: async () => true });
const byName = (results: CheckResult[]): Record<string, CheckResult> => Object.fromEntries(results.map((r) => [r.name, r]));

describe('appDir (issue #54)', () => {
  it('appContext: the flag over the config, relative to the working directory; ctx itself for the same directory', () => {
    const ctx = fakeContext();
    expect(appContext(ctx, null)).toBe(ctx);
    expect(appContext(ctx, { appDir: '.' })).toBe(ctx);
    expect(appContext(ctx, { appDir: 'app' }).cwd).toBe(path.join(ctx.cwd, 'app'));
    expect(appContext(ctx, { appDir: path.join(ctx.cwd, 'app') }).cwd).toBe(path.join(ctx.cwd, 'app')); // loadConfig makes it absolute
    expect(appContext(ctx, { appDir: 'app' }, '../shop').cwd).toBe(path.resolve(ctx.cwd, '../shop'));
  });

  it('doctor checks the app in appDir and the test setup here: it passes in the test package', async () => {
    const ctx = fakeContext();
    monorepo(ctx);
    const results = byName(await runChecks(ctx, undefined, { ...doctorDeps(config()), portFree: async () => true }));
    expect(results['app']).toMatchObject({ status: 'ok', detail: expect.stringMatching(/^app \(appDir\)/) });
    expect(results['Expo project']?.status).toBe('ok');
    // The runner the test package has (Vitest), not Cucumber's packages (the issue's second point).
    expect(results['Quiesco packages']).toMatchObject({ status: 'ok', detail: '@quiesco/agent, @quiesco/vitest, vitest' });
    expect(results['Quiesco versions']).toMatchObject({ status: 'ok', detail: '5 packages at 9.9.9' });
    for (const n of ['config plugin', 'Metro', 'entry file', '<QuiescoRoot>', 'app IDs']) expect(results[n]?.status, n).toBe('ok');
    // (The device checks depend on this machine's SDKs.)
    expect(Object.values(results).filter((r) => r.status === 'fail' && !r.name.startsWith('Android:'))).toEqual([]);
  });

  it('doctor without appDir in the test package says where to point it; --app-dir does it from the command line', async () => {
    const ctx = fakeContext();
    monorepo(ctx);
    const none = byName(await runChecks(ctx, undefined, doctorDeps(config({ appDir: undefined } as Partial<QuiescoConfig>))));
    expect(none['Expo project']).toMatchObject({ status: 'fail', detail: 'expo is not a dependency' });
    const flag = byName(await runChecks(ctx, undefined, doctorDeps({ apps: { android: ANDROID } }), 'app'));
    expect(flag['app']).toMatchObject({ status: 'ok', detail: expect.stringMatching(/^app \(--app-dir\)/) });
    expect(flag['Expo project']?.status).toBe('ok');
    const missing = byName(await runChecks(ctx, undefined, doctorDeps(config({ appDir: 'nowhere' }))));
    expect(missing['project']).toMatchObject({ status: 'fail', fix: expect.stringMatching(/appDir \(quiesco.config\) or --app-dir must name/) });
  });

  it('doctor compares the versions of both packages and says which is the app\'s', async () => {
    const ctx = fakeContext();
    monorepo(ctx, { app: '9.9.8' });
    const results = byName(await runChecks(ctx, undefined, doctorDeps(config())));
    expect(results['Quiesco versions']).toMatchObject({ status: 'fail', detail: expect.stringMatching(/different versions: .*@quiesco\/agent \(app\) 9\.9\.8.*quiesco 9\.9\.9/) });
  });

  it('build runs prebuild and gradle in the app; binaryPath stays relative to the working directory', async () => {
    const ctx = fakeContext();
    monorepo(ctx);
    ctx.put('app/android/app/build/outputs/apk/debug/app-debug.apk', 'apk');
    expect(await buildCommand(['android'], ctx, { loadConfig: async () => config() })).toBe(0);
    expect(ctx.calls.map((c) => [c.command, ...c.args, c.cwd ?? '.'].join(' '))).toEqual(['npx expo prebuild --platform android app', './gradlew assembleDebug app/android']);
    expect(ctx.file('app/.expo/quiesco/build-android.json')).toContain('"binaryPath"');
  });

  it('build for iOS hands xcodebuild the derived data relative to the app', async () => {
    const ctx = fakeContext();
    monorepo(ctx);
    ctx.put('app/ios/shop.xcworkspace/contents.xcworkspacedata', '');
    const binaryPath = 'build/Build/Products/Debug-iphonesimulator/shop.app';
    ctx.put(`${binaryPath}/Info.plist`, '');
    const ios = { appDir: path.join(ctx.cwd, 'app'), apps: { ios: { bundleId: 'com.acme.shop', binaryPath } } };
    expect(await buildCommand(['ios', '--force'], ctx, { loadConfig: async () => ios })).toBe(0);
    const xcode = ctx.calls.find((c) => c.command === 'xcodebuild');
    expect(xcode?.cwd).toBe('app');
    expect(xcode?.args[xcode.args.indexOf('-derivedDataPath') + 1]).toBe('../build');
    expect(xcode?.args[xcode.args.indexOf('-workspace') + 1]).toBe('ios/shop.xcworkspace');
  });

  it('init --upgrade installs the app\'s packages in the app and the rest here, and fixes each side\'s files', async () => {
    const ctx = fakeContext();
    monorepo(ctx, { app: '0.6.0', tests: '0.6.0' });
    ctx.put('app/app.json', JSON.stringify({ expo: { name: 'shop', slug: 'shop', plugins: ['@quiesco/expo-plugin'] } }));
    expect(await upgradeCommand(['--platforms', 'android'], ctx, { loadConfig: async () => config() })).toBe(0);
    const installs = ctx.calls.filter((c) => c.command === 'npm' && c.args[0] === 'install');
    expect(installs.map((c) => `${c.cwd ?? '.'}: ${c.args.join(' ')}`)).toEqual([
      // Exact versions (0.6.0) stay exact (#95)
      'app: install --save-exact @quiesco/agent@9.9.9 @quiesco/native@9.9.9',
      'app: install --save-dev --save-exact @quiesco/expo-plugin@9.9.9',
      '.: install --save-dev --save-exact quiesco@9.9.9 @quiesco/core@9.9.9 @quiesco/vitest@9.9.9',
    ]);
    // app.json's IDs in the app; the scripts are left alone (#95), the missing ones named for the test package.
    expect(JSON.parse(ctx.file('app/app.json') as string).expo.android.package).toBe('com.anonymous.shop');
    expect(JSON.parse(ctx.file('package.json') as string).scripts?.['e2e:android']).toBeUndefined();
    expect(ctx.lines.join('\n')).toMatch(/= scripts — left as they are \(quiesco init would add e2e:start, e2e:android\)/);
    expect(JSON.parse(ctx.file('app/package.json') as string).scripts).toBeUndefined();
  });

  it('quiesco test starts Metro in the app', async () => {
    const spawned: string[] = [];
    let started = false;
    const ctx = fakeContext(() => ({}), {
      httpGet: async () => (started ? { status: 200, body: 'packager-status:running' } : null),
      spawnBackground: (_command, _args, o) => {
        spawned.push(o.cwd);
        started = true;
        return { exited: new Promise(() => {}), stop: async () => {} } satisfies BackgroundProcess;
      },
    });
    const app = path.join(ctx.cwd, 'app');
    const server = await ensureDevServer(ctx, { appDir: app, apps: { ios: { bundleId: 'b', devClient: { metroUrl: 'http://localhost:8082' } } } }, 'ios');
    await server.stop();
    expect(spawned).toEqual([app]);
    expect(ctx.lines.join('\n')).toContain(`in ${app}`);
  });
});
