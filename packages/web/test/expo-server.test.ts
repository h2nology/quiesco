import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ExpoServerDeps } from '../src/expo-server';
import { isServerExport, startExpoServer } from '../src/expo-server';

function fakeChild() {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
  child.kill.mockImplementation(() => child.emit('exit', 0));
  return child;
}

function deps(over: Partial<ExpoServerDeps> & { child?: ReturnType<typeof fakeChild> } = {}) {
  const child = over.child ?? fakeChild();
  let t = 0;
  const d: ExpoServerDeps = {
    spawn: vi.fn(() => child as never),
    freePort: async () => 8123,
    ping: vi.fn(async () => true),
    wait: async (ms) => void (t += ms),
    now: () => t,
    ...over,
  };
  return { d, child };
}

describe('expo serve for server exports', () => {
  it('recognizes a server export (client/ and server/ directories)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-dist-'));
    expect(isServerExport(dir)).toBe(false);
    fs.mkdirSync(path.join(dir, 'client'));
    fs.mkdirSync(path.join(dir, 'server'));
    expect(isServerExport(dir)).toBe(true);
  });

  it('runs `npx expo serve <distDir>` from the project on a free port and waits until it answers', async () => {
    let pings = 0;
    const { d, child } = deps({ ping: vi.fn(async () => ++pings >= 3) });
    const server = await startExpoServer('/work/app/dist', d);
    expect(d.spawn).toHaveBeenCalledWith('npx', ['expo', 'serve', '/work/app/dist', '--port', '8123'], { cwd: '/work/app' });
    expect(server.url).toBe('http://localhost:8123');
    expect(pings).toBe(3);
    await server.close();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('reports the server output when it exits early or never answers', async () => {
    const early = fakeChild();
    const failing = deps({ child: early, ping: vi.fn(async () => {
      early.stderr.emit('data', Buffer.from('CommandError: no dist/server\n'));
      early.emit('exit', 1);
      return false;
    }) });
    await expect(startExpoServer('/work/app/dist', failing.d)).rejects.toThrow(/exited \(code 1\)[\s\S]*no dist\/server/);
    const silent = deps({ ping: vi.fn(async () => false) });
    await expect(startExpoServer('/work/app/dist', silent.d)).rejects.toThrow(/did not answer on http:\/\/localhost:8123 within 60s/);
    expect(silent.child.kill).toHaveBeenCalled();
  });

  it('serves an export directory with any name', async () => {
    const { d } = deps();
    await startExpoServer('/work/app/web-build', d);
    expect(d.spawn).toHaveBeenCalledWith('npx', ['expo', 'serve', '/work/app/web-build', '--port', '8123'], { cwd: '/work/app' });
  });
});
