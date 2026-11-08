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
