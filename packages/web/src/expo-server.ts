/**
 * Expo Router "server" output (`web.output: "server"`, the default of the SDK 58 app template):
 * `expo export --platform web` writes `dist/client` and `dist/server` and no `index.html` — pages are
 * rendered per request. A static file server cannot host that, so Quiesco runs Expo's own production
 * server, `npx expo serve <distDir> --port <port>`, for the session. (`expo serve` takes the export
 * directory: given the project directory it serves that as static files instead.)
 */
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { trackChildProcess } from '@quiesco/core';

import type { StaticServer } from './static-server.js';

const READY_TIMEOUT_MS = 60_000;
const POLL_MS = 250;
const OUTPUT_LINES = 15;

/** A web export made with `web.output: "server"`. */
export function isServerExport(distDir: string): boolean {
  const isDir = (p: string): boolean => fs.existsSync(p) && fs.statSync(p).isDirectory();
  return isDir(path.join(distDir, 'server')) && isDir(path.join(distDir, 'client'));
}

export interface ExpoServerDeps {
  spawn: (command: string, args: string[], options: { cwd: string }) => ChildProcess;
  freePort: () => Promise<number>;
  /** Resolves true once the server answers. */
  ping: (url: string) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
}

export const defaultExpoServerDeps: ExpoServerDeps = {
  // Tracked: a parallel worker ended without async teardown kills it synchronously (Phase 6.12).
  spawn: (command, args, options) => trackChildProcess(nodeSpawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })),
  freePort: () =>
    new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address() as net.AddressInfo;
        srv.close(() => resolve(port));
      });
    }),
  ping: async (url) => {
    try {
      return (await fetch(url)).ok;
    } catch {
      return false;
    }
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export async function startExpoServer(distDir: string, deps: ExpoServerDeps = defaultExpoServerDeps): Promise<StaticServer> {
  const dist = path.resolve(distDir);
  // Run from the project, so npx finds the project's own expo CLI.
  const project = path.dirname(dist);
  const port = await deps.freePort();
  const child = deps.spawn('npx', ['expo', 'serve', dist, '--port', String(port)], { cwd: project });
  const output: string[] = [];
  const collect = (d: Buffer): void => {
    output.push(...d.toString().split('\n').filter((l) => l.trim() !== ''));
    output.splice(0, Math.max(0, output.length - OUTPUT_LINES));
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  let exited: number | null = null;
  child.on('exit', (code) => (exited = code ?? 1));

  const url = `http://localhost:${port}`;
  const deadline = deps.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (exited !== null) throw new Error(`\`npx expo serve\` exited (code ${exited}) before serving ${url}:\n${output.join('\n')}`);
    if (await deps.ping(url)) break;
    if (deps.now() >= deadline) {
      child.kill();
      throw new Error(`\`npx expo serve\` did not answer on ${url} within ${READY_TIMEOUT_MS / 1000}s:\n${output.join('\n')}`);
    }
    await deps.wait(POLL_MS);
  }
  return {
    url,
    close: () =>
      new Promise((resolve) => {
        if (exited !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill();
      }),
  };
}
