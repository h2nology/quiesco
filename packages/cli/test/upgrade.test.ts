import { describe, expect, it } from 'vitest';

import type { QuiescoConfig } from '@quiesco/core';

import { main } from '../src/cli';
import { upgradeCommand } from '../src/commands/upgrade';
import type { UpgradeDeps } from '../src/commands/upgrade';
import type { FakeContext } from './fake-context';
import { fakeContext } from './fake-context';

const OLD_CONFIG = `import { defineConfig } from '@quiesco/core';

export default defineConfig({
  apps: {
    ios: {
      bundleId: 'com.example.app', // TODO: expo.ios.bundleIdentifier
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/quiescotest03.app',
    },
    android: {
      package: 'com.example.app', // TODO: expo.android.package
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      devClient: { scheme: 'myapp', metroUrl: 'http://localhost:8081' }, // TODO: expo.scheme
    },
  },
});
`;

const OLD_CUCUMBER = `export default {
  paths: ['features/**/*.feature'],
  import: ['features/support/**/*.ts', 'features/step_definitions/**/*.ts'],
  format: ['progress'],
};
`;

/** A blank-template project set up by quiesco 0.1.1 (what issue #35's project had), with 0.1.1 installed. */
function oldProject(ctx: FakeContext): void {
  ctx.put(
    'package.json',
    JSON.stringify({
      name: 'quiesco-test-03',
      main: 'index.ts',
      dependencies: { expo: '~58.0.25', '@quiesco/agent': '^0.1.1', '@quiesco/native': '^0.1.1' },
      devDependencies: { quiesco: '^0.1.1', '@quiesco/core': '^0.1.1', '@quiesco/cucumber': '^0.1.1', '@quiesco/expo-plugin': '^0.1.1', '@quiesco/steps': '^0.1.1', '@cucumber/cucumber': '^13.3.0' },
      scripts: { 'e2e:ios': 'quiesco test --platform ios', 'e2e:android': 'quiesco test --platform android' },
    }),
  );
  for (const n of ['@quiesco/agent', '@quiesco/native', 'quiesco', '@quiesco/core', '@quiesco/cucumber', '@quiesco/expo-plugin', '@quiesco/steps']) {
    ctx.put(`node_modules/${n}/package.json`, JSON.stringify({ name: n, version: '0.1.1' }));
  }
  ctx.put('package-lock.json', '{}');
  ctx.put('app.json', JSON.stringify({ expo: { name: 'quiesco-test-03', slug: 'quiesco-test-03', plugins: ['@quiesco/expo-plugin'] } }));
  ctx.put('tsconfig.json', JSON.stringify({ extends: 'expo/tsconfig.base', compilerOptions: { strict: true } }));
  ctx.put('quiesco.config.mts', OLD_CONFIG);
  ctx.put('cucumber.mjs', OLD_CUCUMBER);
  ctx.put('index.ts', "import '@quiesco/agent';\nimport { registerRootComponent } from 'expo';\n\nimport App from './App';\n\nregisterRootComponent(App);\n");
  ctx.put('App.tsx', 'export default function App() { return null; }\n');
}

const nativeApps: UpgradeDeps = { loadConfig: async () => ({ apps: { ios: { bundleId: 'x' }, android: { package: 'x' } } }) as unknown as QuiescoConfig };

describe('quiesco init --upgrade (issues #34, #35)', () => {
  it('upgrades the packages to the CLI version and fixes what older inits wrote', async () => {
    const ctx = fakeContext();
    oldProject(ctx);
    expect(await upgradeCommand([], ctx, nativeApps)).toBe(0);
    // every Quiesco package, also @quiesco/steps that init does not add; @cucumber/cucumber left alone
    expect(ctx.calls.map((c) => `${c.command} ${c.args.join(' ')}`)).toEqual([
      'npm install @quiesco/agent@9.9.9 @quiesco/native@9.9.9',
      'npm install --save-dev quiesco@9.9.9 @quiesco/core@9.9.9 @quiesco/cucumber@9.9.9 @quiesco/expo-plugin@9.9.9 @quiesco/steps@9.9.9',
    ]);
    const out = ctx.lines.join('\n');
    expect(out).toMatch(/\$ versions — 7 Quiesco packages at 9\.9\.9/);
    expect(ctx.file('cucumber.mjs')).toBe(OLD_CUCUMBER.replace("  paths: ['features/**/*.feature'],\n", ''));
    expect(JSON.parse(ctx.file('tsconfig.json') as string).compilerOptions).toEqual({ strict: true, allowImportingTsExtensions: true });
    expect(JSON.parse(ctx.file('app.json') as string).expo).toMatchObject({ scheme: 'quiesco-test-03', ios: { bundleIdentifier: 'com.anonymous.quiescotest03' }, android: { package: 'com.anonymous.quiescotest03' } });
    const config = ctx.file('quiesco.config.mts') as string;
    expect(config).toContain("      bundleId: 'com.anonymous.quiescotest03',\n");
    expect(config).toContain("      package: 'com.anonymous.quiescotest03',\n");
    expect(config).toContain("      devClient: { scheme: 'quiesco-test-03', metroUrl: 'http://localhost:8081' },\n");
    expect(config).not.toContain('TODO');
    expect(JSON.parse(ctx.file('package.json') as string).scripts).toMatchObject({ 'e2e:build:ios': 'quiesco build ios', 'e2e:build:android': 'quiesco build android', 'e2e:start': expect.any(String) });
    expect(ctx.file('index.ts')).toContain('QuiescoRoot');
    expect(out).toMatch(/Upgraded to Quiesco 9\.9\.9\. Check the setup with: npx quiesco doctor/);
  });

  it('changes nothing when run again', async () => {
    const ctx = fakeContext();
    oldProject(ctx);
    await upgradeCommand([], ctx, nativeApps);
    const files = ['package.json', 'app.json', 'tsconfig.json', 'quiesco.config.mts', 'cucumber.mjs', 'index.ts'].map((f) => ctx.file(f));
    ctx.lines.length = 0;
    ctx.calls.length = 0;
    expect(await upgradeCommand([], ctx, nativeApps)).toBe(0);
    expect(ctx.calls).toEqual([]);
    expect(['package.json', 'app.json', 'tsconfig.json', 'quiesco.config.mts', 'cucumber.mjs', 'index.ts'].map((f) => ctx.file(f))).toEqual(files);
    const steps = ctx.lines.filter((l) => /^[+~=$!] /.test(l));
    expect(steps.every((l) => l.startsWith('= '))).toBe(true);
    expect(steps.join('\n')).toMatch(/= versions — 7 Quiesco packages at 9\.9\.9/);
  });

  it('--dry-run lists the changes and makes none', async () => {
    const ctx = fakeContext();
    oldProject(ctx);
    const before = ['package.json', 'app.json', 'tsconfig.json', 'quiesco.config.mts', 'cucumber.mjs', 'index.ts'].map((f) => ctx.file(f));
    expect(await upgradeCommand(['--dry-run'], ctx, nativeApps)).toBe(0);
    expect(ctx.calls).toEqual([]);
    expect(['package.json', 'app.json', 'tsconfig.json', 'quiesco.config.mts', 'cucumber.mjs', 'index.ts'].map((f) => ctx.file(f))).toEqual(before);
    const out = ctx.lines.join('\n');
    expect(out).toMatch(/! install — npm install @quiesco\/agent@9\.9\.9/);
    expect(out).toMatch(/~ cucumber\.mjs — removed paths/);
    expect(out).toMatch(/~ quiesco\.config\.mts — placeholders replaced with app\.json's values: bundleId 'com\.anonymous\.quiescotest03'/);
    expect(out).toMatch(/Dry run: nothing was changed/);
  });

  it('lists what it cannot change safely: custom paths, a tsconfig with comments, a dynamic app config', async () => {
    const ctx = fakeContext();
    oldProject(ctx);
    ctx.put('cucumber.mjs', "export default { paths: ['e2e/**/*.feature'] };\n");
    ctx.put('tsconfig.json', '{\n  // Expo\n  "extends": "expo/tsconfig.base"\n}\n');
    ctx.put('app.config.ts', 'export default ({ config }) => config;\n');
    expect(await upgradeCommand(['--skip-install'], ctx, nativeApps)).toBe(0);
    const out = ctx.lines.join('\n');
    expect(out).toMatch(/! cucumber\.mjs — sets paths/);
    expect(out).toMatch(/! tsconfig\.json — add "allowImportingTsExtensions": true/);
    expect(out).toMatch(/! app IDs — set expo\.ios\.bundleIdentifier, expo\.android\.package, expo\.scheme in app\.config\.ts/);
    expect(out).toMatch(/! quiesco\.config\.mts — placeholders left \(TODO: expo\.ios\.bundleIdentifier, expo\.android\.package, expo\.scheme\)/);
    expect(out).toMatch(/the lines marked ! need you/);
  });

  it('takes the platforms from --platforms or the config, and stops when it has neither', async () => {
    const ctx = fakeContext();
    oldProject(ctx);
    const failing: UpgradeDeps = { loadConfig: async () => Promise.reject(new Error('no quiesco.config found')) };
    expect(await upgradeCommand(['--skip-install'], ctx, failing)).toBe(1);
    expect(ctx.errors.join('\n')).toMatch(/cannot read quiesco\.config \(no quiesco\.config found\)[\s\S]*--platforms ios,android,web/);
    expect(await upgradeCommand(['--skip-install', '--platforms', 'web'], ctx, failing)).toBe(0);
    expect(JSON.parse(ctx.file('package.json') as string).scripts['e2e:web']).toContain('quiesco test --platform web');
    expect(await upgradeCommand(['--platforms', 'tv'], ctx, failing)).toBe(2);
  });

  it('is reached through quiesco init --upgrade', async () => {
    const ctx = fakeContext();
    expect(await main(['init', '--upgrade', '--dry-run'], ctx)).toBe(1);
    expect(ctx.errors.join('\n')).toMatch(/quiesco init --upgrade: .* is not an Expo project/);
  });
});
