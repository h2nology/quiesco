import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findTarballs, iosAppName } from '../src/commands/init';
import { main } from '../src/cli';
import { fakeContext, freshExpoApp } from './fake-context';

describe('quiesco init', () => {
  it('sets up a fresh Expo Router app', async () => {
    const ctx = fakeContext();
    freshExpoApp(ctx);
    expect(await main(['init'], ctx)).toBe(0);
    // dependencies with npm (package-lock.json), web included because react-native-web is installed
    expect(ctx.calls.map((c) => `${c.command} ${c.args.join(' ')}`)).toEqual([
      // the CLI's own version, not whatever the registry metadata calls latest (issue #17)
      'npm install @quiesco/agent@9.9.9 @quiesco/native@9.9.9',
      'npm install --save-dev quiesco@9.9.9 @quiesco/core@9.9.9 @quiesco/cucumber@9.9.9 @quiesco/expo-plugin@9.9.9 @cucumber/cucumber @quiesco/web@9.9.9 playwright',
    ]);
    expect(ctx.lines.join('\n')).toMatch(/\$ versions — 7 Quiesco packages at 9\.9\.9/);
    expect(JSON.parse(ctx.file('app.json') as string).expo.plugins).toEqual(['expo-router', '@quiesco/expo-plugin']);
    expect(ctx.file('metro.config.js')).toContain('withQuiesco(getDefaultConfig(__dirname))');
    expect(ctx.file('index.ts')).toMatch(/^\/\/.*\n\/\/.*\nimport '@quiesco\/agent';\nimport 'expo-router\/entry';\n$/);
    const pkg = JSON.parse(ctx.file('package.json') as string);
    expect(pkg.main).toBe('index.ts');
    expect(pkg.scripts).toMatchObject({ 'e2e:web': expect.stringContaining('quiesco test --platform web'), 'e2e:android': 'quiesco test --platform android' });
    const config = ctx.file('quiesco.config.mts') as string;
    expect(config).toContain("web: { distDir: 'dist' }");
    expect(config).toContain("// sync: { ignoreElements: ['logo-glow'] },");
    expect(config).toContain("devClient: { scheme: 'myapp'");
    expect(config).toContain("package: 'com.example.app', // TODO: expo.android.package");
    // expo prebuild names the Xcode project after expo.name ("my-app" ⇒ myapp.app)
    expect(config).toContain("binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/myapp.app',\n");
    // no `paths`: cucumber-js merges it with the paths given on the command line (issue #8)
    expect(ctx.file('cucumber.mjs')).toContain("import: ['features/support/**/*.ts'");
    expect(ctx.file('cucumber.mjs')).not.toContain('paths');
    expect(ctx.file('features/support/quiesco.ts')).toContain("import '@quiesco/cucumber/register'");
    expect(ctx.file('features/step_definitions/app.steps.ts')).toContain("expectVisible({ id: 'home' })");
    expect(ctx.lines.join('\n')).toMatch(/Wrap the root layout in <QuiescoRoot>/);
  });

  it('is idempotent and never overwrites existing files', async () => {
    const ctx = fakeContext();
    freshExpoApp(ctx);
    await main(['init', '--skip-install'], ctx);
    ctx.put('quiesco.config.mts', '// mine\n');
    const before = ctx.file('index.ts');
    ctx.lines.length = 0;
    expect(await main(['init', '--skip-install'], ctx)).toBe(0);
    expect(ctx.file('quiesco.config.mts')).toBe('// mine\n');
    expect(ctx.file('index.ts')).toBe(before);
    expect(JSON.parse(ctx.file('app.json') as string).expo.plugins).toEqual(['expo-router', '@quiesco/expo-plugin']);
    const out = ctx.lines.join('\n');
    expect(out).toMatch(/= app\.json — @quiesco\/expo-plugin already listed/);
    expect(out).toMatch(/= metro\.config\.js — already uses withQuiesco/);
    expect(out).toMatch(/= index\.ts — already imports @quiesco\/agent/);
    expect(out).toMatch(/= quiesco\.config\.mts — already exists/);
    expect(out).toMatch(/! install — npm install @quiesco\/agent/);
    expect(ctx.calls).toEqual([]);
  });

  it('leaves a custom metro config alone and explains the change; prepends the import to a custom entry', async () => {
    const ctx = fakeContext();
    freshExpoApp(ctx);
    ctx.put('pnpm-lock.yaml', '');
    ctx.put('metro.config.js', 'module.exports = { custom: true };\n');
    const pkg = JSON.parse(ctx.file('package.json') as string);
    pkg.main = 'App.tsx';
    ctx.put('package.json', JSON.stringify(pkg));
    ctx.put('App.tsx', "import { registerRootComponent } from 'expo';\n");
    expect(await main(['init', '--platforms', 'ios'], ctx)).toBe(0);
    expect(ctx.calls[0]?.command).toBe('pnpm');
    expect(ctx.file('metro.config.js')).toBe('module.exports = { custom: true };\n');
    expect(ctx.lines.join('\n')).toMatch(/! metro\.config\.js — wrap the exported config/);
    expect(ctx.file('App.tsx')).toMatch(/^import '@quiesco\/agent';.*\nimport \{ registerRootComponent \}/);
    expect(ctx.file('quiesco.config.mts')).not.toContain('web:');
    expect(ctx.calls[1]?.args).not.toContain('playwright');
  });

  it('wraps the component of registerRootComponent(App) in <QuiescoRoot> (blank template, issue #20)', async () => {
    const ctx = fakeContext();
    freshExpoApp(ctx);
    const pkg = JSON.parse(ctx.file('package.json') as string);
    pkg.main = 'index.ts';
    ctx.put('package.json', JSON.stringify(pkg));
    fs.rmSync(path.join(ctx.cwd, 'src/app/_layout.tsx'));
    const blank = [
      "import { registerRootComponent } from 'expo';",
      '',
      "import App from './App';",
      '',
      "// registerRootComponent calls AppRegistry.registerComponent('main', () => App);",
      'registerRootComponent(App);',
      '',
    ].join('\n');
    ctx.put('index.ts', blank);
    ctx.put('App.tsx', 'export default function App() { return null; }\n');
    expect(await main(['init', '--skip-install'], ctx)).toBe(0);
    expect(ctx.file('index.ts')).toBe(
      [
        "import { QuiescoRoot } from '@quiesco/agent'; // first: Quiesco hooks into React before the app loads",
        "import { registerRootComponent } from 'expo';",
        "import { createElement } from 'react';",
        '',
        "import App from './App';",
        '',
        "// registerRootComponent calls AppRegistry.registerComponent('main', () => App);",
        '// <QuiescoRoot> connects the app to Quiesco and remounts it for the soft reset before each scenario',
        '// (it renders App unchanged in builds without EXPO_PUBLIC_QUIESCO=1).',
        'function QuiescoApp() {',
        '  return createElement(QuiescoRoot, null, createElement(App));',
        '}',
        '',
        'registerRootComponent(QuiescoApp);',
        '',
      ].join('\n'),
    );
    const out = ctx.lines.join('\n');
    expect(out).toMatch(/~ index\.ts — added import '@quiesco\/agent' as the first line; wrapped App in <QuiescoRoot>/);
    expect(out).not.toMatch(/Wrap the root layout/);
    expect(out).toMatch(/1\. Give the home screen testID="home"/);
    // run again: nothing changes
    ctx.lines.length = 0;
    const before = ctx.file('index.ts');
    expect(await main(['init', '--skip-install'], ctx)).toBe(0);
    expect(ctx.file('index.ts')).toBe(before);
    expect(ctx.lines.join('\n')).toMatch(/= index\.ts — already imports @quiesco\/agent/);
  });

  it('lets tsc accept the .ts imports of step files (issue #21)', async () => {
    const ctx = fakeContext();
    freshExpoApp(ctx);
    ctx.put('tsconfig.json', '{\n  "extends": "expo/tsconfig.base",\n  "compilerOptions": {\n    "strict": true\n  }\n}\n');
    expect(await main(['init', '--skip-install'], ctx)).toBe(0);
    expect(JSON.parse(ctx.file('tsconfig.json') as string)).toEqual({ extends: 'expo/tsconfig.base', compilerOptions: { strict: true, allowImportingTsExtensions: true } });
    expect(ctx.lines.join('\n')).toMatch(/~ tsconfig\.json — allowImportingTsExtensions/);
    expect(ctx.file('features/support/quiesco.ts')).toMatch(/type stripping[\s\S]*'\.\/todo-driver\.ts'[\s\S]*parameter properties/);
    ctx.lines.length = 0;
    expect(await main(['init', '--skip-install'], ctx)).toBe(0);
    expect(ctx.lines.join('\n')).toMatch(/= tsconfig\.json — already allows \.ts imports/);
    // a tsconfig with comments is not rewritten
    const commented = fakeContext();
    freshExpoApp(commented);
    commented.put('tsconfig.json', '{\n  // mine\n  "extends": "expo/tsconfig.base"\n}\n');
    expect(await main(['init', '--skip-install'], commented)).toBe(0);
    expect(commented.file('tsconfig.json')).toBe('{\n  // mine\n  "extends": "expo/tsconfig.base"\n}\n');
    expect(commented.lines.join('\n')).toMatch(/! tsconfig\.json — add "allowImportingTsExtensions": true/);
  });

  it('leaves entries it cannot wrap safely alone and says what to do', async () => {
    for (const source of [
      "import { registerRootComponent } from 'expo';\nimport { App } from 'some-package';\nregisterRootComponent(App);\n",
      "import { registerRootComponent } from 'expo';\nregisterRootComponent(() => null);\n",
    ]) {
      const ctx = fakeContext();
      freshExpoApp(ctx);
      const pkg = JSON.parse(ctx.file('package.json') as string);
      pkg.main = 'index.ts';
      ctx.put('package.json', JSON.stringify(pkg));
      ctx.put('index.ts', source);
      expect(await main(['init', '--skip-install'], ctx)).toBe(0);
      expect(ctx.file('index.ts')).toBe(`import '@quiesco/agent'; // first: Quiesco hooks into React before the app loads\n${source}`);
      expect(ctx.lines.join('\n')).toMatch(/1\. Wrap the root layout in <QuiescoRoot>/);
    }
  });

  it('installs from tarballs and pins the packages they depend on', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-tgz-'));
    for (const f of ['quiesco-0.0.0.tgz', 'quiesco-agent-0.0.0.tgz', 'quiesco-native-0.0.0.tgz', 'quiesco-core-0.0.0.tgz', 'quiesco-cucumber-0.0.0.tgz', 'quiesco-expo-plugin-0.0.0.tgz', 'quiesco-protocol-0.0.0.tgz', 'quiesco-web-0.0.0.tgz']) {
      fs.writeFileSync(path.join(dir, f), '');
    }
    const ctx = fakeContext();
    freshExpoApp(ctx);
    expect(await main(['init', '--packages', dir], ctx)).toBe(0);
    const pkg = JSON.parse(ctx.file('package.json') as string);
    // npm: only the packages not installed directly (an override for a direct dependency is EOVERRIDE)
    expect(pkg.overrides).toEqual({ '@quiesco/protocol': `file:${path.join(dir, 'quiesco-protocol-0.0.0.tgz')}` });
    expect(ctx.calls[0]?.args).toEqual(['install', `file:${path.join(dir, 'quiesco-agent-0.0.0.tgz')}`, `file:${path.join(dir, 'quiesco-native-0.0.0.tgz')}`]);
    expect(ctx.calls[1]?.args).toContain('@cucumber/cucumber');
    expect(ctx.calls[1]?.args).toContain('playwright');
    // pnpm resolves each range on its own: every Quiesco package is pinned
    const pnpm = fakeContext();
    freshExpoApp(pnpm);
    pnpm.put('pnpm-lock.yaml', '');
    pnpm.put('pnpm-workspace.yaml', 'minimumReleaseAgeExclude:\n  - foo@1.0.0');
    expect(await main(['init', '--packages', dir], pnpm)).toBe(0);
    // in pnpm-workspace.yaml: pnpm 10+ ignores the "pnpm" field of package.json
    const yaml = pnpm.file('pnpm-workspace.yaml') as string;
    expect(yaml).toMatch(/^minimumReleaseAgeExclude:\n {2}- foo@1\.0\.0\noverrides:\n/);
    expect(yaml.match(/^ {2}"(?:quiesco|@quiesco\/[\w-]+)": "file:.*\.tgz"$/gm)).toHaveLength(8);
    expect(yaml).toContain(`  "@quiesco/protocol": ${JSON.stringify(`file:${path.join(dir, 'quiesco-protocol-0.0.0.tgz')}`)}`);
    expect(JSON.parse(pnpm.file('package.json') as string).pnpm).toBeUndefined();
    fs.rmSync(path.join(dir, 'quiesco-web-0.0.0.tgz'));
    const missing = fakeContext();
    freshExpoApp(missing);
    expect(await main(['init', '--packages', dir], missing)).toBe(1);
    expect(missing.errors[0]).toMatch(/no tarball for @quiesco\/web/);
  });

  it('fails when the package manager installed another version than the CLI asked for (issue #17)', async () => {
    // e.g. pnpm resolving from stale registry metadata: the scripts init writes need commands the old version lacks
    const ctx = fakeContext();
    freshExpoApp(ctx);
    ctx.put('pnpm-lock.yaml', '');
    const real = ctx.exec;
    ctx.exec = async (c, a, o) => {
      const r = await real(c, a, o);
      if (c === 'pnpm' && a.includes('-D')) for (const name of ['quiesco', '@quiesco/core']) ctx.put(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '0.1.1' }));
      return r;
    };
    expect(await main(['init', '--platforms', 'ios'], ctx)).toBe(1);
    const err = ctx.errors.join('\n');
    expect(err).toMatch(/quiesco: 0\.1\.1 \(wanted 9\.9\.9\)/);
    expect(err).toMatch(/@quiesco\/core: 0\.1\.1 \(wanted 9\.9\.9\)/);
    expect(err).not.toMatch(/@quiesco\/agent:/);
    expect(err).toMatch(/minimumReleaseAge/);
    expect(err).toMatch(/pnpm add -D quiesco@9\.9\.9 @quiesco\/core@9\.9\.9 @quiesco\/cucumber@9\.9\.9 @quiesco\/expo-plugin@9\.9\.9\n/);
    // nothing else was written: the project is not set up against the wrong version
    expect(ctx.file('quiesco.config.mts')).toBeNull();
  });

  it('matches tarball names exactly (quiesco vs quiesco-agent)', () => {
    const found = findTarballs('/t', ['quiesco', '@quiesco/agent'], () => ['quiesco-agent-0.1.0.tgz', 'quiesco-0.1.0.tgz', 'notes.txt']);
    expect(found.get('quiesco')).toBe(path.join('/t', 'quiesco-0.1.0.tgz'));
    expect(found.get('@quiesco/agent')).toBe(path.join('/t', 'quiesco-agent-0.1.0.tgz'));
  });

  it('refuses a directory that is not an Expo project and stops when an install fails', async () => {
    const notExpo = fakeContext();
    notExpo.put('package.json', '{"name":"x"}');
    expect(await main(['init'], notExpo)).toBe(1);
    expect(notExpo.errors[0]).toMatch(/not an Expo project/);
    const failing = fakeContext(() => ({ code: 1, stderr: 'E404 not found' }));
    freshExpoApp(failing);
    expect(await main(['init'], failing)).toBe(1);
    expect(failing.errors.join('\n')).toMatch(/E404[\s\S]*failed \(exit 1\)/);
    expect(failing.file('quiesco.config.mts')).toBeNull();
  });

  it('names the iOS .app the way expo prebuild names the Xcode project', () => {
    expect(iosAppName('app')).toEqual({ name: 'app', exact: true });
    expect(iosAppName('My App')).toEqual({ name: 'MyApp', exact: true });
    expect(iosAppName('Todo_App 2')).toEqual({ name: 'TodoApp2', exact: true });
    expect(iosAppName('x-y.z')).toEqual({ name: 'xyz', exact: true });
    // Not ASCII: Expo transliterates some letters (Ø ⇒ O) that this does not, so the config says to check.
    expect(iosAppName('Café')).toEqual({ name: 'Cafe', exact: false });
    expect(iosAppName('日本アプリ')).toEqual({ name: 'app', exact: false });
    expect(iosAppName(undefined)).toEqual({ name: 'app', exact: false });
  });
});
