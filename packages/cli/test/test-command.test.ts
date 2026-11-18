import { describe, expect, it } from 'vitest';

import { main } from '../src/cli';
import { fakeContext } from './fake-context';

describe('quiesco test', () => {
  it('sets QUIESCO_PLATFORM and passes the other arguments to cucumber-js', async () => {
    const ctx = fakeContext(() => ({ code: 3 }));
    expect(await main(['test', '--platform', 'web', '--tags', '@smoke', 'features/login.feature'], ctx)).toBe(3);
    expect(ctx.calls).toEqual([{ command: 'npx', args: ['cucumber-js', '--tags', '@smoke', 'features/login.feature'], env: { QUIESCO_PLATFORM: 'web' } }]);
  });

  it('takes the platform from QUIESCO_PLATFORM, and refuses a missing platform', async () => {
    const env = fakeContext();
    env.env = { QUIESCO_PLATFORM: 'ios' };
    expect(await main(['test'], env)).toBe(0);
    expect(env.calls[0]?.env?.['QUIESCO_PLATFORM']).toBe('ios');
    const none = fakeContext();
    expect(await main(['test'], none)).toBe(2);
    expect(none.errors[0]).toMatch(/--platform ios\|android\|web/);
    const bad = fakeContext();
    expect(await main(['test', '--platform', 'symbian'], bad)).toBe(1);
    expect(bad.errors[0]).toMatch(/Unknown platform "symbian"/);
  });

  it('runs Jest or Vitest with --runner', async () => {
    const jest = fakeContext();
    expect(await main(['test', '--platform', 'ios', '--runner', 'jest', 'e2e/todo.test.js'], jest)).toBe(0);
    expect(jest.calls).toEqual([{ command: 'npx', args: ['jest', 'e2e/todo.test.js'], env: { QUIESCO_PLATFORM: 'ios' } }]);
    const vitest = fakeContext();
    expect(await main(['test', '--runner=vitest', '--platform', 'android', '--config', 'vitest.e2e.config.mts'], vitest)).toBe(0);
    expect(vitest.calls[0]?.args).toEqual(['vitest', 'run', '--config', 'vitest.e2e.config.mts']);
    const unknown = fakeContext();
    expect(await main(['test', '--platform', 'web', '--runner', 'mocha'], unknown)).toBe(2);
    expect(unknown.errors[0]).toMatch(/unknown runner "mocha"/);
  });

  it('uses the runner whose Quiesco package the project has, cucumber when several or none', async () => {
    const run = async (devDependencies: Record<string, string>): Promise<string | undefined> => {
      const ctx = fakeContext();
      ctx.put('package.json', JSON.stringify({ devDependencies }));
      expect(await main(['test', '--platform', 'web'], ctx)).toBe(0);
      return ctx.calls[0]?.args[0];
    };
    expect(await run({ '@quiesco/vitest': '1.0.0', vitest: '5.1.0' })).toBe('vitest');
    expect(await run({ '@quiesco/jest': '1.0.0' })).toBe('jest');
    expect(await run({ '@quiesco/cucumber': '1.0.0' })).toBe('cucumber-js');
    expect(await run({ '@quiesco/cucumber': '1.0.0', '@quiesco/vitest': '1.0.0' })).toBe('cucumber-js');
    expect(await run({})).toBe('cucumber-js');
  });

  it('passes the parallel flags of the runners through (Phase 6.12)', async () => {
    for (const [runner, flags] of [['cucumber', ['--parallel', '2']], ['jest', ['-w', '2']], ['vitest', ['--fileParallelism', '--maxWorkers', '2']]] as const) {
      const ctx = fakeContext();
      expect(await main(['test', '--platform', 'web', '--runner', runner, ...flags], ctx)).toBe(0);
      expect(ctx.calls[0]?.args.slice(-flags.length)).toEqual(flags);
    }
  });

  it('--workers N becomes the parallel flags of each runner', async () => {
    const run = async (runner: string, n: string) => {
      const ctx = fakeContext();
      const code = await main(['test', '--platform', 'ios', '--runner', runner, '--workers', n, 'x'], ctx);
      return { code, args: ctx.calls[0]?.args, errors: ctx.errors };
    };
    expect((await run('cucumber', '3')).args).toEqual(['cucumber-js', '--parallel', '3', 'x']);
    expect((await run('cucumber', '1')).args).toEqual(['cucumber-js', 'x']);
    expect((await run('jest', '2')).args).toEqual(['jest', '--maxWorkers', '2', 'x']);
    expect((await run('vitest', '2')).args).toEqual(['vitest', 'run', '--fileParallelism', '--maxWorkers', '2', 'x']);
    expect((await run('vitest', '1')).args).toEqual(['vitest', 'run', '--no-file-parallelism', '--maxWorkers', '1', 'x']);
    const bad = await run('jest', 'two');
    expect(bad.code).toBe(2);
    expect(bad.errors[0]).toMatch(/--workers takes a whole number/);
  });

  it('drops a leading -- and passes what follows to the runner untouched (issue #7)', async () => {
    const tags = fakeContext();
    expect(await main(['test', '--platform', 'web', '--', '--tags', '@debug'], tags)).toBe(0);
    expect(tags.calls[0]?.args).toEqual(['cucumber-js', '--tags', '@debug']);
    const name = fakeContext();
    expect(await main(['test', '--platform', 'ios', '--workers', '2', 'features/a.feature', '--', '--name', 'Add a todo'], name)).toBe(0);
    expect(name.calls[0]?.args).toEqual(['cucumber-js', '--parallel', '2', 'features/a.feature', '--name', 'Add a todo']);
    // after --, Quiesco's own option names belong to the runner
    const runnerOwn = fakeContext();
    expect(await main(['test', '--platform', 'web', '--runner', 'vitest', '--', '--help', '--workers', '1'], runnerOwn)).toBe(0);
    expect(runnerOwn.calls[0]?.args).toEqual(['vitest', 'run', '--help', '--workers', '1']);
  });

  it('prints its own help with --help or -h, without running anything (issue #7)', async () => {
    for (const flag of ['--help', '-h']) {
      const ctx = fakeContext();
      expect(await main(['test', flag], ctx)).toBe(0);
      expect(ctx.calls).toEqual([]);
      const help = ctx.lines.join('\n');
      expect(help).toMatch(/^Usage: quiesco test/);
      for (const option of ['--platform', '--runner', '--workers']) expect(help).toContain(option);
      expect(help).toContain('quiesco test --platform ios --tags @smoke');
    }
    const top = fakeContext();
    await main(['--help'], top);
    expect(top.lines.join('\n')).toContain('quiesco test --help');
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
