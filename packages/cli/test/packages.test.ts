import { describe, expect, it } from 'vitest';

import { HELP, main } from '../src/cli';
import { CLI_COMMANDS, installedVersion, scriptCommands } from '../src/packages';
import { fakeContext } from './fake-context';

describe('CLI_COMMANDS', () => {
  it('lists exactly the commands the CLI has (doctor checks scripts against it)', async () => {
    const helped = [...HELP.matchAll(/^ {2}([a-z]+) {2,}/gm)].map((m) => m[1]);
    expect([...CLI_COMMANDS].sort()).toEqual([...helped].sort());
    // and every one is dispatched (an unknown command exits 2 with "unknown command")
    for (const command of CLI_COMMANDS) {
      const ctx = fakeContext();
      await main([command, '--definitely-not-an-option'], ctx).catch(() => undefined);
      expect(ctx.errors.join('\n')).not.toMatch(/unknown command/);
    }
  });
});

describe('scriptCommands', () => {
  it('finds quiesco <command> in scripts, not package names, files or options', () => {
    expect(
      scriptCommands({
        a: 'EXPO_PUBLIC_QUIESCO=1 expo export --platform web && quiesco test --platform web',
        b: 'npx quiesco build ios; pnpm exec quiesco doctor',
        c: 'quiesco --version && cat quiesco.config.mts && node -e "require(\'@quiesco/agent\')"',
      }),
    ).toEqual([
      { script: 'a', command: 'test' },
      { script: 'b', command: 'build' },
      { script: 'b', command: 'doctor' },
    ]);
    expect(scriptCommands(undefined)).toEqual([]);
  });
});

describe('installedVersion', () => {
  it('reads node_modules/<name>/package.json in the project or a parent (hoisted workspaces)', () => {
    const ctx = fakeContext();
    ctx.put('node_modules/@quiesco/core/package.json', JSON.stringify({ version: '1.2.3' }));
    ctx.put('apps/mobile/package.json', '{}');
    expect(installedVersion(ctx, '@quiesco/core')).toBe('1.2.3');
    expect(installedVersion(ctx, '@quiesco/core', `${ctx.cwd}/apps/mobile`)).toBe('1.2.3');
    expect(installedVersion(ctx, '@quiesco/agent')).toBeNull();
  });
});
