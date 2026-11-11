import { describe, expect, it } from 'vitest';

import { main } from '../src/cli';
import { fakeContext } from './fake-context';

describe('quiesco test', () => {
  it('sets QUIESCO_PLATFORM and passes the other arguments to cucumber-js', async () => {
    const ctx = fakeContext(() => ({ code: 3 }));
    expect(await main(['test', '--platform', 'web', '--tags', '@smoke', 'features/login.feature'], ctx)).toBe(3);
    expect(ctx.calls).toEqual([{ command: 'npx', args: ['cucumber-js', '--tags', '@smoke', 'features/login.feature'], env: { QUIESCO_PLATFORM: 'web' } }]);
  });

  it('takes the platform from QUIESCO_PLATFORM, and refuses a missing platform and --parallel', async () => {
    const env = fakeContext();
    env.env = { QUIESCO_PLATFORM: 'ios' };
    expect(await main(['test'], env)).toBe(0);
    expect(env.calls[0]?.env?.['QUIESCO_PLATFORM']).toBe('ios');
    const none = fakeContext();
    expect(await main(['test'], none)).toBe(2);
    expect(none.errors[0]).toMatch(/--platform ios\|android\|web/);
    const parallel = fakeContext();
    expect(await main(['test', '--platform', 'android', '--parallel', '2'], parallel)).toBe(2);
    expect(parallel.calls).toEqual([]);
    const bad = fakeContext();
    expect(await main(['test', '--platform', 'symbian'], bad)).toBe(1);
    expect(bad.errors[0]).toMatch(/Unknown platform "symbian"/);
  });

  it('runs Jest or Vitest with --runner, and refuses their parallel flags', async () => {
    const jest = fakeContext();
    expect(await main(['test', '--platform', 'ios', '--runner', 'jest', 'e2e/todo.test.js'], jest)).toBe(0);
    expect(jest.calls).toEqual([{ command: 'npx', args: ['jest', 'e2e/todo.test.js'], env: { QUIESCO_PLATFORM: 'ios' } }]);
    const vitest = fakeContext();
    expect(await main(['test', '--runner=vitest', '--platform', 'android', '--config', 'vitest.e2e.config.mts'], vitest)).toBe(0);
    expect(vitest.calls[0]?.args).toEqual(['vitest', 'run', '--config', 'vitest.e2e.config.mts']);
    for (const [runner, flag] of [['jest', '-w'], ['jest', '--maxWorkers=4'], ['vitest', '--fileParallelism']] as const) {
      const ctx = fakeContext();
      expect(await main(['test', '--platform', 'web', '--runner', runner, flag, '2'], ctx)).toBe(2);
      expect(ctx.calls).toEqual([]);
      expect(ctx.errors[0]).toMatch(/one device at a time/);
    }
    const unknown = fakeContext();
    expect(await main(['test', '--platform', 'web', '--runner', 'mocha'], unknown)).toBe(2);
    expect(unknown.errors[0]).toMatch(/unknown runner "mocha"/);
  });

  it('prints help and rejects unknown commands', async () => {
    const ctx = fakeContext();
    expect(await main([], ctx)).toBe(0);
    expect(ctx.lines[0]).toMatch(/^Usage: quiesco <command>/);
    expect(await main(['deploy'], ctx)).toBe(2);
    expect(ctx.errors[0]).toMatch(/unknown command "deploy"/);
    expect(await main(['--version'], ctx)).toBe(0);
    expect(ctx.lines.at(-1)).toMatch(/^\d+\.\d+\.\d+/);
  });
});
