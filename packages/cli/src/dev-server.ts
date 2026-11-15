/**
 * The Metro dev server for `quiesco test` (issue #5), like Playwright's `webServer`: when the app loads its JS
 * from Metro (`devClient.metroUrl` on iOS / Android, `apps.web.url` on the web) and nothing answers there,
 * start `expo start` with EXPO_PUBLIC_QUIESCO=1, wait until it is ready, and stop it when the run ends. A
 * Metro that is already running is used as it is. Here, in the CLI, because it is the one process of the run:
 * parallel workers (cucumber-js child processes, Jest workers) would each start and stop their own.
 */
import path from 'node:path';

import type { QuiescoConfig } from '@quiesco/core';

import type { BackgroundProcess, CliContext, CliPlatform } from './context.js';

export const DEFAULT_DEV_SERVER_TIMEOUT_MS = 120_000;
const POLL_MS = 500;
const DEFAULT_METRO_URL = 'http://localhost:8081';

/** Where the app loads its JS from on `platform`, or null when it does not use a dev server. */
export function devServerUrl(config: QuiescoConfig, platform: CliPlatform): string | null {
  if (platform === 'web') return config.apps.web?.url ?? null;
  const dc = config.apps[platform]?.devClient;
  return dc === undefined ? null : (dc.metroUrl ?? DEFAULT_METRO_URL);
}

/** Whether Metro answers at `url` (its `/status` says `packager-status:running`). */
export async function metroRunning(ctx: CliContext, url: string): Promise<boolean> {
  const r = await ctx.httpGet(new URL('/status', url).toString(), 2000);
  return r !== null && r.body.includes('packager-status:running');
}

export interface DevServer {
  /** Stops Metro when this run started it; nothing otherwise. */
  stop(): Promise<void>;
}

const NOTHING: DevServer = { stop: async () => {} };

/**
 * Make sure the dev server the app needs is running. Returns how to stop what was started. Throws when it
 * was started but did not become ready (with the end of its log).
 */
export async function ensureDevServer(ctx: CliContext, config: QuiescoConfig, platform: CliPlatform): Promise<DevServer> {
  const url = devServerUrl(config, platform);
  if (url === null) return NOTHING;
  if (await metroRunning(ctx, url)) {
    ctx.out(`quiesco: using the Metro dev server at ${url}`);
    return NOTHING;
  }
  const opts = config.devServer ?? {};
  const where = new URL(url);
  if (opts.autoStart === false || !['localhost', '127.0.0.1', '[::1]'].includes(where.hostname)) {
    ctx.out(`quiesco: nothing answers at ${url}; start Metro there (EXPO_PUBLIC_QUIESCO=1 npx expo start) — ${opts.autoStart === false ? 'devServer.autoStart is false' : 'it is not on this machine'}`);
    return NOTHING;
  }
  const port = where.port !== '' ? where.port : where.protocol === 'https:' ? '443' : '80';
  const [command, ...args] = (opts.command ?? ['npx', 'expo', 'start', '--port', '{port}']).map((a) => a.replaceAll('{port}', port));
  if (command === undefined) throw new Error('devServer.command is empty');
  const logFile = path.join(ctx.cwd, config.artifacts?.dir ?? 'artifacts', 'metro.log');
  ctx.out(`quiesco: starting Metro (${[command, ...args].join(' ')}) with EXPO_PUBLIC_QUIESCO=1; log: ${path.relative(ctx.cwd, logFile)}`);
  const proc = ctx.spawnBackground(command, args, { cwd: ctx.cwd, env: { ...ctx.env, EXPO_PUBLIC_QUIESCO: '1' }, logFile });
  const offInterrupt = ctx.onInterrupt(() => proc.stop());
  const server: DevServer = {
    stop: async () => {
      offInterrupt();
      await proc.stop();
    },
  };
  await waitReady(ctx, url, proc, opts.timeoutMs ?? DEFAULT_DEV_SERVER_TIMEOUT_MS, logFile).catch(async (e: unknown) => {
    await server.stop();
    throw e;
  });
  ctx.out(`quiesco: Metro is ready at ${url}`);
  return server;
}

async function waitReady(ctx: CliContext, url: string, proc: BackgroundProcess, timeoutMs: number, logFile: string): Promise<void> {
  let exitCode: number | null = null;
  void proc.exited.then((c) => (exitCode = c));
  for (let waited = 0; ; waited += POLL_MS) {
    if (await metroRunning(ctx, url)) return;
    if (exitCode !== null) throw new Error(`Metro exited (code ${exitCode}) before it was ready.${tail(ctx, logFile)}`);
    if (waited >= timeoutMs) throw new Error(`Metro was not ready at ${url} within ${timeoutMs}ms (devServer.timeoutMs).${tail(ctx, logFile)}`);
    await ctx.sleep(POLL_MS);
  }
}

function tail(ctx: CliContext, logFile: string): string {
  const text = ctx.readFile(logFile);
  if (text === null || text.trim() === '') return '';
  return `\nLast lines of ${logFile}:\n${text.trimEnd().split('\n').slice(-15).join('\n')}`;
}
