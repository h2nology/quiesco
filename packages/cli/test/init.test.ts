import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findTarballs } from '../src/commands/init';
import { main } from '../src/cli';
import { fakeContext, freshExpoApp } from './fake-context';

describe('quiesco init', () => {
  it('sets up a fresh Expo Router app', async () => {
    const ctx = fakeContext();
    freshExpoApp(ctx);
    expect(await main(['init'], ctx)).toBe(0);
    // dependencies with npm (package-lock.json), web included because react-native-web is installed
    expect(ctx.calls.map((c) => `${c.command} ${c.args.join(' ')}`)).toEqual([
      'npm install @quiesco/agent @quiesco/native',
      'npm install --save-dev quiesco @quiesco/core @quiesco/cucumber @quiesco/expo-plugin @cucumber/cucumber @quiesco/web playwright',
    ]);
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
    expect(await main(['init', '--packages', dir], pnpm)).toBe(0);
    expect(Object.keys(JSON.parse(pnpm.file('package.json') as string).pnpm.overrides)).toHaveLength(8);
    fs.rmSync(path.join(dir, 'quiesco-web-0.0.0.tgz'));
    const missing = fakeContext();
    freshExpoApp(missing);
    expect(await main(['init', '--packages', dir], missing)).toBe(1);
    expect(missing.errors[0]).toMatch(/no tarball for @quiesco\/web/);
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
});
