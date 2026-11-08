import { describe, expect, it } from 'vitest';

import type { DoctorDeps } from '../src/commands/doctor';
import { doctorCommand, firstImport, runChecks } from '../src/commands/doctor';
import { main } from '../src/cli';
import { fakeContext, freshExpoApp } from './fake-context';

const deps = (overrides: Partial<DoctorDeps> = {}): DoctorDeps => ({
  loadConfig: async () => ({ apps: { web: { distDir: 'dist' } } }),
  portFree: async () => true,
  ...overrides,
});

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
    expect(byName['<QuiescoRoot>']?.status).toBe('warn');
    expect(byName['quiesco.config']).toMatchObject({ status: 'fail', detail: 'No Quiesco config found in /x' });
  });

  it('passes on a project set up by quiesco init', async () => {
    const { ctx } = setUpProject();
    await main(['init', '--skip-install'], ctx);
    const pkg = JSON.parse(ctx.file('package.json') as string);
    pkg.dependencies['@quiesco/agent'] = '0.0.0';
    pkg.devDependencies = { '@quiesco/cucumber': '0.0.0', '@cucumber/cucumber': '13.3.0' };
    ctx.put('package.json', JSON.stringify(pkg));
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
