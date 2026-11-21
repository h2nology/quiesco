import { describe, expect, it } from 'vitest';

import type { DoctorDeps } from '../src/commands/doctor';
import { doctorCommand, firstImport, runChecks } from '../src/commands/doctor';
import { main } from '../src/cli';
import type { FakeContext } from './fake-context';
import { fakeContext, freshExpoApp } from './fake-context';

const deps = (overrides: Partial<DoctorDeps> = {}): DoctorDeps => ({
  loadConfig: async () => ({ apps: { web: { distDir: 'dist' } } }),
  portFree: async () => true,
  ...overrides,
});

/** node_modules/<name>/package.json for each package (the fake installs nothing by itself here). */
function installed(ctx: FakeContext, versions: Record<string, string>): void {
  for (const [name, version] of Object.entries(versions)) ctx.put(`node_modules/${name}/package.json`, JSON.stringify({ name, version }));
}

function setUpProject() {
  const ctx = fakeContext();
  freshExpoApp(ctx);
  return { ctx };
}

describe('quiesco doctor', () => {
  it('finds the first import of the entry file', () => {
    expect(firstImport("// comment\n/* block */\nimport '@quiesco/agent';\nimport 'expo-router/entry';")).toBe('@quiesco/agent');
    expect(firstImport("import { x } from 'react';\nimport '@quiesco/agent';")).toBe('react');
    expect(firstImport("require('@quiesco/agent');")).toBe('@quiesco/agent');
    expect(firstImport('export {};')).toBeNull();
  });

  it('warns about CI set in an interactive terminal, not in a CI job (issue #3)', async () => {
    const names = async (env: NodeJS.ProcessEnv, interactive: boolean) => {
      const { ctx } = setUpProject();
      ctx.env = env;
      ctx.interactive = interactive;
      return (await runChecks(ctx, 'web', deps())).find((r) => r.name === 'CI');
    };
    expect(await names({ CI: '1' }, true)).toMatchObject({ status: 'warn', detail: 'CI=1 is set in this terminal', fix: expect.stringMatching(/does not watch files/) });
    expect(await names({ CI: '1' }, false)).toBeUndefined();
    expect(await names({ CI: 'false' }, true)).toBeUndefined();
    expect(await names({}, true)).toBeUndefined();
  });

  it('flags a fresh Expo app that is not set up yet, with fixes', async () => {
    const { ctx } = setUpProject();
    const results = await runChecks(ctx, 'web', deps({ loadConfig: async () => Promise.reject(new Error('No Quiesco config found in /x')) }));
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName['Node.js']?.status).toBe('ok');
    expect(byName['Expo project']?.status).toBe('ok');
    expect(byName['Quiesco packages']).toMatchObject({ status: 'fail', detail: expect.stringMatching(/missing @quiesco\/agent/) });
    expect(byName['config plugin']?.status).toBe('warn');
    expect(byName['Metro']).toMatchObject({ status: 'fail', fix: expect.stringMatching(/withQuiesco/) });
    expect(byName['entry file']).toMatchObject({ status: 'fail', detail: '"main" is expo-router/entry' });
    // the agent connects from <QuiescoRoot>: missing, no test can run (issue #20)
    expect(byName['<QuiescoRoot>']).toMatchObject({ status: 'fail', detail: 'not found in src/app/_layout.tsx', fix: expect.stringMatching(/connects to Quiesco from it/) });
    expect(byName['quiesco.config']).toMatchObject({ status: 'fail', detail: 'No Quiesco config found in /x' });
  });

  it('passes on a project set up by quiesco init', async () => {
    const { ctx } = setUpProject();
    await main(['init', '--skip-install'], ctx);
    const pkg = JSON.parse(ctx.file('package.json') as string);
    pkg.dependencies['@quiesco/agent'] = '0.0.0';
    pkg.devDependencies = { '@quiesco/cucumber': '0.0.0', '@cucumber/cucumber': '13.3.0' };
    ctx.put('package.json', JSON.stringify(pkg));
    installed(ctx, { '@quiesco/agent': '9.9.9', '@quiesco/cucumber': '9.9.9' });
    ctx.put('src/app/_layout.tsx', "import { QuiescoRoot } from '@quiesco/agent';\n");
    ctx.put('dist/index.html', '');
    const exe = `${ctx.cwd}/chromium`;
    ctx.put('chromium', '');
    const withExe = { ...ctx, exec: async (c: string, a: readonly string[]) => (c === 'node' ? { code: 0, stdout: exe, stderr: '' } : ctx.exec(c, a)) };
    ctx.lines.length = 0;
    expect(await doctorCommand([], withExe, deps())).toBe(0);
    const out = ctx.lines.join('\n');
    expect(out).not.toMatch(/❌/);
    expect(out).toMatch(/✅ Web: Chromium/);
    expect(out).toMatch(/✅ entry file: index\.ts imports @quiesco\/agent first/);
    expect(out).toMatch(/All required checks passed/);
  });

  it('checks the browser the config runs (devices.web.browser)', async () => {
    const { ctx } = setUpProject();
    const scripts: string[] = [];
    const missing = { ...ctx, exec: async (c: string, a: readonly string[]) => (c === 'node' ? (scripts.push(a[2] as string), { code: 0, stdout: '/nowhere/webkit', stderr: '' }) : ctx.exec(c, a)) };
    const results = await runChecks(missing, 'web', deps({ loadConfig: async () => ({ apps: { web: { distDir: 'dist' } }, devices: { web: { browser: 'webkit' } } }) }));
    expect(scripts[0]).toMatch(/pw\.webkit\.executablePath\(\)/);
    expect(results.find((r) => r.name.startsWith('Web: '))).toMatchObject({ name: 'Web: WebKit', status: 'fail', detail: 'Playwright webkit is not installed', fix: 'npx playwright install webkit' });
  });

  it('checks that the Quiesco packages have one version and the scripts name existing commands (issue #17)', async () => {
    const check = async (versions: Record<string, string>, scripts: Record<string, string> = {}, extra: Record<string, string> = {}) => {
      const { ctx } = setUpProject();
      const pkg = JSON.parse(ctx.file('package.json') as string);
      pkg.devDependencies = { ...Object.fromEntries(Object.keys(versions).map((n) => [n, `^${versions[n]}`])), '@cucumber/cucumber': '13.3.0', ...extra };
      pkg.scripts = scripts;
      ctx.put('package.json', JSON.stringify(pkg));
      installed(ctx, versions);
      const results = await runChecks(ctx, 'web', deps());
      return { versions: results.find((r) => r.name === 'Quiesco versions'), scripts: results.find((r) => r.name === 'scripts') };
    };
    const same = await check({ quiesco: '9.9.9', '@quiesco/agent': '9.9.9', '@quiesco/core': '9.9.9' }, { 'e2e:ios': 'quiesco test --platform ios', 'e2e:build:ios': 'npx quiesco build ios', v: 'quiesco --version', c: 'cat quiesco.config.mts @quiesco/agent' });
    expect(same.versions).toMatchObject({ status: 'ok', detail: '3 packages at 9.9.9' });
    expect(same.scripts).toBeUndefined();

    // what the issue saw: init 0.3.0 wrote `quiesco build`, pnpm installed 0.1.1 for some packages
    const mixed = await check({ quiesco: '0.1.1', '@quiesco/agent': '0.3.0', '@quiesco/core': '0.10.0' });
    expect(mixed.versions).toMatchObject({ status: 'fail', detail: 'different versions: @quiesco/agent 0.3.0, @quiesco/core 0.10.0, quiesco 0.1.1' });
    expect(mixed.versions?.fix).toContain('@quiesco/agent@0.10.0 @quiesco/core@0.10.0 quiesco@0.10.0');

    const older = await check({ quiesco: '0.1.1', '@quiesco/agent': '0.1.1' }, { 'e2e:build:ios': 'quiesco build ios && quiesco frobnicate' });
    expect(older.versions).toMatchObject({ status: 'warn', detail: 'the project has 0.1.1; this doctor is 9.9.9' });
    expect(older.scripts).toMatchObject({ status: 'fail', detail: '"e2e:build:ios" runs `quiesco frobnicate`', fix: expect.stringMatching(/project has Quiesco 0\.1\.1; upgrade it/) });

    const notInstalled = await check({ quiesco: '9.9.9' }, {}, { '@quiesco/web': '^9.9.9' });
    expect(notInstalled.versions).toMatchObject({ status: 'fail', detail: 'not installed: @quiesco/web' });
  });

  it('looks for <QuiescoRoot> in the entry and the component it registers (issue #20)', async () => {
    const root = async (files: Record<string, string>, main = 'index.ts') => {
      const ctx = fakeContext();
      ctx.put('package.json', JSON.stringify({ main, dependencies: { expo: '~58.0.25' } }));
      for (const [f, c] of Object.entries(files)) ctx.put(f, c);
      return (await runChecks(ctx, 'web', deps())).find((r) => r.name === '<QuiescoRoot>');
    };
    const entry = "import '@quiesco/agent';\nimport { registerRootComponent } from 'expo';\nimport Main from './src/Main';\nregisterRootComponent(Main);\n";
    // the blank template's root component is not in a usual place
    expect(await root({ 'index.ts': entry, 'src/Main.jsx': 'export default () => <QuiescoRoot />;' })).toMatchObject({ status: 'ok', detail: 'in src/Main.jsx' });
    expect(await root({ 'index.ts': entry, 'src/Main.jsx': 'export default () => null;' })).toMatchObject({ status: 'fail', detail: 'not found in index.ts, src/Main.jsx' });
    // init's wrapper in the entry
    expect(await root({ 'index.ts': "import { QuiescoRoot } from '@quiesco/agent';\n" })).toMatchObject({ status: 'ok', detail: 'in index.ts' });
    expect(await root({ 'App.jsx': '<QuiescoRoot>' }, 'expo/AppEntry')).toMatchObject({ status: 'ok', detail: 'in App.jsx' });
  });

  it('flags what older inits wrote: paths in the cucumber config, .ts imports without allowImportingTsExtensions (issue #35)', async () => {
    const { ctx } = setUpProject();
    ctx.put('cucumber.mjs', "export default {\n  paths: ['features/**/*.feature'],\n};\n");
    ctx.put('tsconfig.json', '{\n  // comments are fine\n  "extends": "expo/tsconfig.base"\n}\n');
    ctx.put('features/step_definitions/students.steps.ts', "import { StudentDriver } from '../support/student-driver.ts';\n");
    const byName = Object.fromEntries((await runChecks(ctx, 'web', deps())).map((r) => [r.name, r]));
    expect(byName['cucumber paths']).toMatchObject({ status: 'warn', detail: 'cucumber.mjs sets paths', fix: expect.stringMatching(/runs every feature[\s\S]*init --upgrade/) });
    expect(byName['tsconfig']).toMatchObject({ status: 'fail', detail: expect.stringContaining('features/step_definitions/students.steps.ts imports a .ts file'), fix: expect.stringContaining('TS5097') });

    // fixed (or nothing imports .ts): no report
    ctx.put('cucumber.mjs', "export default { format: ['progress'] };\n");
    ctx.put('tsconfig.json', '{ "compilerOptions": { "allowImportingTsExtensions": true } }');
    const names = (await runChecks(ctx, 'web', deps())).map((r) => r.name);
    expect(names).not.toContain('cucumber paths');
    expect(names).not.toContain('tsconfig');
    ctx.put('tsconfig.json', '{}');
    ctx.put('features/step_definitions/students.steps.ts', "import { Given } from '@cucumber/cucumber';\n");
    expect((await runChecks(ctx, 'web', deps())).map((r) => r.name)).not.toContain('tsconfig');
  });

  it('notes a native platform without a build script, as info that neither warns nor fails (issue #35)', async () => {
    const { ctx } = setUpProject();
    ctx.put('app.json', JSON.stringify({ expo: { scheme: 'qt', ios: { bundleIdentifier: 'com.anonymous.qt' }, android: { package: 'com.anonymous.qt' } } }));
    const nativeConfig = deps({ loadConfig: async () => ({ apps: { ios: { bundleId: 'com.anonymous.qt' }, android: { package: 'com.anonymous.qt', devClient: { scheme: 'qt' } } } }) });
    const results = await runChecks(ctx, undefined, nativeConfig);
    expect(results.filter((r) => r.name === 'build scripts').map((r) => [r.status, r.detail])).toEqual([
      ['info', 'no script runs quiesco build ios'],
      ['info', 'no script runs quiesco build android'],
    ]);
    const pkg = JSON.parse(ctx.file('package.json') as string);
    pkg.scripts = { 'e2e:build:ios': 'quiesco build ios', 'build:droid': 'npx quiesco build android --force' };
    ctx.put('package.json', JSON.stringify(pkg));
    expect((await runChecks(ctx, undefined, nativeConfig)).map((r) => r.name)).not.toContain('build scripts');
  });

  describe('app IDs (issue #34)', () => {
    const native = (android: Record<string, unknown> = { package: 'com.anonymous.qt', devClient: { scheme: 'qt' } }, ios: Record<string, unknown> = { bundleId: 'com.anonymous.qt' }) =>
      deps({ loadConfig: async () => ({ apps: { ios, android } }) as never });
    const appIds = async (ctx: FakeContext, d: DoctorDeps) => (await runChecks(ctx, 'web', d)).filter((r) => /app ID/.test(r.name));

    it('fails on the placeholders init wrote, naming them', async () => {
      const { ctx } = setUpProject();
      ctx.put('quiesco.config.mts', "      package: 'com.example.app', // TODO: expo.android.package\n      devClient: { scheme: 'myapp' }, // TODO: expo.scheme\n");
      expect(await appIds(ctx, native({ package: 'com.example.app', devClient: { scheme: 'myapp' } }))).toEqual([
        expect.objectContaining({ name: 'app IDs', status: 'fail', detail: "quiesco.config.mts still has init's placeholders (TODO: expo.android.package, expo.scheme)", fix: expect.stringContaining('init --upgrade') }),
      ]);
    });

    it('compares quiesco.config with app.json: missing, different, the same', async () => {
      const { ctx } = setUpProject();
      ctx.put('app.json', JSON.stringify({ expo: { scheme: 'other', ios: { bundleIdentifier: 'com.anonymous.qt' } } }));
      const [r] = await appIds(ctx, native());
      expect(r).toMatchObject({ status: 'fail' });
      expect(r?.detail).toBe("app.json has no expo.android.package (the build gets Expo's default, not com.anonymous.qt); devClient.scheme is qt, app.json expo.scheme is other");
      ctx.put('app.json', JSON.stringify({ expo: { scheme: ['qt', 'x'], ios: { bundleIdentifier: 'com.anonymous.qt' }, android: { package: 'com.anonymous.qt' } } }));
      expect(await appIds(ctx, native())).toEqual([expect.objectContaining({ status: 'ok', detail: 'quiesco.config matches app.json' })]);
    });

    it('resolves a dynamic app config with expo config; warns when that fails (#96)', async () => {
      const { ctx } = setUpProject();
      ctx.put('app.json', JSON.stringify({ expo: { scheme: 'qt' } }));
      ctx.put('app.config.ts', 'export default ({ config }) => config;\n');
      const calls: { args: readonly string[]; env?: NodeJS.ProcessEnv }[] = [];
      let resolved: { code: number; stdout: string } = { code: 0, stdout: JSON.stringify({ name: 'qt', scheme: 'qt', ios: { bundleIdentifier: 'com.anonymous.qt' }, android: { package: 'com.anonymous.qt' } }) };
      const expo = {
        ...ctx,
        exec: async (c: string, a: readonly string[], o?: { env?: NodeJS.ProcessEnv }) => {
          if (c !== 'npx' || a[0] !== 'expo') return ctx.exec(c, a);
          calls.push({ args: a, env: o?.env });
          return { ...resolved, stderr: '' };
        },
      };
      expect(await appIds(expo, native())).toEqual([expect.objectContaining({ status: 'ok', detail: 'quiesco.config matches app.config.ts (resolved)' })]);
      expect(calls[0]?.args).toEqual(['expo', 'config', '--json', '--type', 'public']);
      expect(calls[0]?.env?.['EXPO_PUBLIC_QUIESCO']).toBe('1');
      // One run of expo config per doctor run; the plugins come from it too.
      calls.length = 0;
      resolved = { code: 0, stdout: JSON.stringify({ scheme: 'qt', ios: { bundleIdentifier: 'com.anonymous.qt' }, android: { package: 'com.anonymous.qt' }, plugins: [['@quiesco/expo-plugin', {}]] }) };
      const all = await runChecks(expo, 'web', native());
      expect(all.find((r) => r.name === 'config plugin')).toMatchObject({ status: 'ok', detail: '@quiesco/expo-plugin in the resolved app config' });
      expect(calls).toHaveLength(1);
      resolved = { code: 0, stdout: JSON.stringify({ scheme: 'qt', plugins: ['expo-router'] }) };
      expect((await runChecks(expo, 'web', native())).find((r) => r.name === 'config plugin')).toMatchObject({ status: 'warn', detail: '@quiesco/expo-plugin is not in the resolved app config plugins' });
      resolved = { code: 0, stdout: JSON.stringify({ scheme: 'qt', ios: { bundleIdentifier: 'com.other' }, android: { package: 'com.anonymous.qt' } }) };
      expect(await appIds(expo, native())).toEqual([expect.objectContaining({ status: 'fail', detail: 'quiesco.config has com.anonymous.qt, app.config.ts (resolved) expo.ios.bundleIdentifier is com.other' })]);
      resolved = { code: 1, stdout: '' };
      expect(await appIds(expo, native())).toEqual([expect.objectContaining({ status: 'warn', detail: 'app.config.ts found, and `npx expo config` could not resolve it; cannot compare the app IDs' })]);
      resolved = { code: 0, stdout: 'not json' };
      expect(await appIds(expo, native())).toEqual([expect.objectContaining({ status: 'warn' })]);
    });

    it('compares the builds: prebuilt android project, iOS Info.plist', async () => {
      const { ctx } = setUpProject();
      ctx.put('app.json', JSON.stringify({ expo: { scheme: 'qt', ios: { bundleIdentifier: 'com.anonymous.qt' }, android: { package: 'com.anonymous.qt' } } }));
      ctx.put('android/app/build.gradle', "android {\n    defaultConfig {\n        applicationId 'com.anonymous.old'\n    }\n}\n");
      ctx.put('android/app/src/main/AndroidManifest.xml', '<data android:scheme="exp+qt"/>');
      ctx.put('ios/build/Q.app/Info.plist', '');
      const plutil = { ...ctx, exec: async (c: string, a: readonly string[]) => (c === 'plutil' ? { code: 0, stdout: 'com.anonymous.quiesco-test\n', stderr: '' } : ctx.exec(c, a)) };
      const results = (await runChecks(plutil, 'web', native(undefined, { bundleId: 'com.anonymous.qt', binaryPath: 'ios/build/Q.app' }))).filter((r) => /app ID/.test(r.name));
      expect(results.map((r) => [r.name, r.status, r.detail])).toEqual([
        ['app IDs', 'ok', 'quiesco.config matches app.json'],
        ['Android: app ID', 'fail', 'android/app/build.gradle has applicationId com.anonymous.old; AndroidManifest.xml registers no qt:// scheme (quiesco.config: com.anonymous.qt, qt://)'],
        ['iOS: app ID', 'fail', 'ios/build/Q.app is com.anonymous.quiesco-test (quiesco.config: com.anonymous.qt)'],
      ]);
      ctx.put('android/app/build.gradle', 'applicationId "com.anonymous.qt"\n');
      ctx.put('android/app/src/main/AndroidManifest.xml', '<data android:scheme="qt"/>');
      expect((await runChecks(ctx, 'web', native())).map((r) => r.name)).not.toContain('Android: app ID');
    });
  });

  it('checks Android tools and the build, and a busy port', async () => {
    const ctx = fakeContext((command, args) => {
      if (command === 'adb' && args[0] === 'version') return { stdout: 'Android Debug Bridge version 1.0.41' };
      if (command === 'adb' && args[0] === 'devices') return { stdout: 'List of devices attached\nemulator-5554\tdevice\n' };
      if (command === 'emulator') return { stdout: 'Medium_Phone_API_37.0\n' };
      return {};
    });
    freshExpoApp(ctx);
    const results = await runChecks(ctx, 'android', deps({ loadConfig: async () => ({ apps: { android: { package: 'p', binaryPath: 'app.apk' } } }), portFree: async () => false }));
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName['Android: adb']?.status).toBe('ok');
    expect(byName['Android: devices']).toMatchObject({ status: 'ok', detail: '1 online, AVDs: Medium_Phone_API_37.0' });
    expect(byName['Android: app build']).toMatchObject({ status: 'warn', detail: 'app.apk not found' });
    expect(byName['port']).toMatchObject({ status: 'warn', detail: '7357 is in use' });
  });

  it('reports missing iOS tooling off macOS and missing adb', async () => {
    const linux = fakeContext(() => ({ code: 127 }), { platform: 'linux' });
    freshExpoApp(linux);
    const ios = await runChecks(linux, 'ios', deps());
    expect(ios.find((r) => r.name === 'iOS')).toMatchObject({ status: 'fail', detail: expect.stringMatching(/need macOS/) });
    const android = await runChecks(linux, 'android', deps());
    expect(android.find((r) => r.name === 'Android: adb')).toMatchObject({ status: 'fail', fix: expect.stringMatching(/ANDROID_HOME/) });
    expect(await doctorCommand(['--platform', 'android'], linux, deps())).toBe(1);
  });
});
