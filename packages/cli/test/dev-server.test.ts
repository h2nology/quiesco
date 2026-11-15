import { describe, expect, it } from 'vitest';

import type { QuiescoConfig } from '@quiesco/core';

import { devServerUrl, ensureDevServer } from '../src/dev-server';
import { testCommand } from '../src/commands/test';
import type { BackgroundProcess } from '../src/context';
import { fakeContext } from './fake-context';

const ios = (extra: Partial<QuiescoConfig> = {}): QuiescoConfig => ({ apps: { ios: { bundleId: 'b', devClient: { metroUrl: 'http://localhost:8082' } } }, ...extra });

/** Metro that answers after `readyAfter` polls (Infinity: never); records spawns and stops. */
function metro(opts: { running?: boolean; readyAfter?: number; exitCode?: number } = {}) {
  const spawned: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv; logFile: string }[] = [];
  let stops = 0;
  let polls = 0;
  let started = opts.running === true;
  const ctx = fakeContext(() => ({}), {
    httpGet: async (url) => {
      expect(url).toMatch(/\/status$/);
      if (!started) return null;
      polls++;
      return polls > (opts.readyAfter ?? 0) ? { status: 200, body: 'packager-status:running' } : null;
    },
    spawnBackground: (command, args, o) => {
      spawned.push({ command, args, env: o.env, logFile: o.logFile });
      started = true;
      const proc: BackgroundProcess = {
        exited: opts.exitCode !== undefined ? Promise.resolve(opts.exitCode) : new Promise(() => {}),
        stop: async () => void stops++,
      };
      return proc;
    },
  });
  return { ctx, spawned, stops: () => stops };
}

describe('the Metro dev server (issue #5)', () => {
  it('is the dev client\'s metroUrl (default :8081), or the web url', () => {
    expect(devServerUrl(ios(), 'ios')).toBe('http://localhost:8082');
    expect(devServerUrl({ apps: { android: { package: 'p', devClient: { scheme: 's' } } } }, 'android')).toBe('http://localhost:8081');
    expect(devServerUrl({ apps: { android: { package: 'p', binaryPath: 'a.apk' } } }, 'android')).toBeNull();
    expect(devServerUrl({ apps: { web: { distDir: 'dist' } } }, 'web')).toBeNull();
    expect(devServerUrl({ apps: { web: { url: 'http://localhost:8081' } } }, 'web')).toBe('http://localhost:8081');
  });

  it('reuses a running Metro', async () => {
    const m = metro({ running: true });
    const s = await ensureDevServer(m.ctx, ios(), 'ios');
    await s.stop();
    expect(m.spawned).toEqual([]);
    expect(m.ctx.lines.join('\n')).toContain('using the Metro dev server at http://localhost:8082');
    // the runner learns it, so an unknown bundle blames that Metro rather than metro.config.js (issue #19)
    expect(s.env).toEqual({ QUIESCO_DEV_SERVER_REUSED: 'http://localhost:8082' });
  });

  it('starts Metro with EXPO_PUBLIC_QUIESCO=1 on the configured port, waits for it, and stops it', async () => {
    const m = metro({ readyAfter: 3 });
    const s = await ensureDevServer(m.ctx, ios(), 'ios');
    expect(s.env).toEqual({});
    expect(m.spawned).toHaveLength(1);
    expect(m.spawned[0]).toMatchObject({ command: 'npx', args: ['expo', 'start', '--port', '8082'], env: { EXPO_PUBLIC_QUIESCO: '1' } });
    expect(m.spawned[0]?.logFile).toMatch(/artifacts\/metro\.log$/);
    expect(m.stops()).toBe(0);
    await s.stop();
    expect(m.stops()).toBe(1);
  });

  it('a custom command; reports a Metro that exits or never gets ready, and stops it', async () => {
    const custom = metro({ readyAfter: 0 });
    await ensureDevServer(custom.ctx, ios({ devServer: { command: ['pnpm', 'start:e2e', '--port', '{port}'] } }), 'ios');
    expect(custom.spawned[0]).toMatchObject({ command: 'pnpm', args: ['start:e2e', '--port', '8082'] });

    const dies = metro({ readyAfter: Infinity, exitCode: 1 });
    dies.ctx.put('artifacts/metro.log', 'Error: Cannot find module expo\n');
    await expect(ensureDevServer(dies.ctx, ios(), 'ios')).rejects.toThrow(/Metro exited \(code 1\) before it was ready\.\nLast lines of .*metro\.log:\nError: Cannot find module expo/);
    expect(dies.stops()).toBe(1);

    const slow = metro({ readyAfter: Infinity });
    await expect(ensureDevServer(slow.ctx, ios({ devServer: { timeoutMs: 2000 } }), 'ios')).rejects.toThrow(/not ready at http:\/\/localhost:8082 within 2000ms/);
    expect(slow.stops()).toBe(1);
  });

  it('does not start one when autoStart is false, or for another machine', async () => {
    const off = metro();
    await ensureDevServer(off.ctx, ios({ devServer: { autoStart: false } }), 'ios');
    const remote = metro();
    await ensureDevServer(remote.ctx, { apps: { ios: { bundleId: 'b', devClient: { metroUrl: 'http://192.168.1.5:8081' } } } }, 'ios');
    expect([...off.spawned, ...remote.spawned]).toEqual([]);
    expect(remote.ctx.lines.join('\n')).toContain('it is not on this machine');
  });

  it('quiesco test stops the Metro it started once the runner is done, also when the tests fail', async () => {
    const m = metro({ readyAfter: 1 });
    const runs: string[] = [];
    m.ctx.run = async (command, args) => (runs.push([command, ...args].join(' ')), 1);
    expect(await testCommand(['--platform', 'ios'], m.ctx, { loadConfig: async () => ios() })).toBe(1);
    expect(runs).toEqual(['npx cucumber-js']);
    expect(m.stops()).toBe(1);
  });

  it('quiesco test tells the runner about a reused Metro, and only then (issue #19)', async () => {
    for (const running of [true, false]) {
      const m = metro(running ? { running: true } : { readyAfter: 1 });
      const envs: (NodeJS.ProcessEnv | undefined)[] = [];
      m.ctx.run = async (_command, _args, options) => (envs.push(options?.env), 0);
      expect(await testCommand(['--platform', 'ios'], m.ctx, { loadConfig: async () => ios() })).toBe(0);
      expect(envs[0]?.['QUIESCO_DEV_SERVER_REUSED']).toBe(running ? 'http://localhost:8082' : undefined);
    }
  });
});
