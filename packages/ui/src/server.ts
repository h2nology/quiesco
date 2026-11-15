/**
 * The `quiesco ui` server (P5): serves the web app, lists the tests, runs what the browser asks for
 * (one run at a time: one device), and streams the run events to every open page.
 *
 * Local only: it listens on 127.0.0.1, refuses other Host / Origin headers (DNS rebinding) and requires
 * the token from the URL it prints (kept in a cookie after the first page load). Files are served only
 * from the artifacts directory (evidence) and the listed test files (source view).
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

import { RunEventServer, RunState } from '@quiesco/core';
import type { RunEvent, RunnerName, TestList, TestRef } from '@quiesco/protocol';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import type { ClientMessage, RunningInfo, ServerMessage, UiInfo } from './messages.js';
import type { RunHandle } from './spawn.js';
import { targetArgs } from './targets.js';
import type { RunTarget } from './targets.js';

export interface UiServerOptions {
  cwd: string;
  runner: RunnerName;
  platform: string;
  /** Start the runner with `args` added (the target) and `env` added (QUIESCO_EVENTS). */
  startRun(args: string[], env: Record<string, string>, onOutput: (stream: 'stdout' | 'stderr', text: string) => void): RunHandle;
  listTests(): Promise<TestList>;
  /** Absolute path of the artifacts directory (evidence files). */
  artifactsDir: string;
  /** The built web app; null serves a minimal page (tests of the server). */
  staticDir: string | null;
  port?: number;
  host?: string;
  token?: string;
}

export interface UiServer {
  readonly url: string;
  readonly port: number;
  readonly token: string;
  close(): Promise<void>;
}

const OUTPUT_KEEP = 200_000;
const COOKIE = 'quiesco_ui';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};
/** Evidence and source files: media as such, everything else as plain text (never HTML: no script). */
function fileType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.json'].includes(ext) ? (MIME[ext] as string) : 'text/plain; charset=utf-8';
}

function version(): string {
  return (createRequire(import.meta.url)('../package.json') as { version: string }).version;
}

/** `child` is `root` or inside it, after resolving symlinks. */
function inside(root: string, child: string): boolean {
  try {
    const r = fs.realpathSync(root);
    const c = fs.realpathSync(child);
    return c === r || c.startsWith(r + path.sep);
  } catch {
    return false;
  }
}

export async function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? randomBytes(16).toString('hex');
  const info: UiInfo = { project: path.basename(options.cwd), runner: options.runner, platform: options.platform, version: version() };
  const state = new RunState();
  const clients = new Set<WebSocket>();
  let list: TestList | null = null;
  let listing = false;
  let relistQueued = false;
  let running: RunningInfo | null = null;
  let handle: RunHandle | null = null;
  let output = '';
  let port = 0;

  const send = (ws: WebSocket, m: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  const broadcast = (m: ServerMessage) => {
    const data = JSON.stringify(m);
    for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
  };

  /**
   * Running chosen tests: Vitest and Jest report the other tests of their files as skipped (filtered
   * out). Those reports are dropped, so a test keeps its last real result, and the total is the
   * number of chosen tests.
   */
  let chosen: ReadonlySet<string> | null = null;
  const filtered = (event: RunEvent): RunEvent | null => {
    if (chosen === null) return event;
    if (event.type === 'run:start' || event.type === 'total:update') return { ...event, total: chosen.size, totalIsEstimate: false };
    if ((event.type === 'test:start' || event.type === 'test:end') && !chosen.has(event.test.id)) {
      if (event.type === 'test:start' || event.status === 'skipped') return null;
    }
    return event;
  };
  const events = new RunEventServer({
    onEvent: (raw) => {
      const event = filtered(raw);
      if (event === null) return;
      state.apply(event);
      broadcast({ type: 'event', event });
    },
  });
  await events.listen();

  const knownTests = (): Map<string, TestRef> => {
    const m = new Map<string, TestRef>();
    for (const t of list?.tests ?? []) m.set(t.id, t);
    for (const t of state.tests.values()) m.set(t.test.id, { ...m.get(t.test.id), ...t.test });
    return m;
  };

  const relist = async (): Promise<void> => {
    if (listing || running !== null) {
      relistQueued = true;
      return;
    }
    listing = true;
    broadcast({ type: 'list', list, listing: true });
    try {
      list = await options.listTests();
    } catch (e) {
      list = { runner: options.runner, files: [], tests: [], errors: [{ message: (e as Error).message }] };
    }
    listing = false;
    broadcast({ type: 'list', list, listing: false });
    watchFiles();
  };

  const run = (target: RunTarget): string | null => {
    if (running !== null) return 'A run is already in progress (one device: one run at a time).';
    let args: string[];
    try {
      args = targetArgs(options.runner, target, knownTests());
    } catch (e) {
      return (e as Error).message;
    }
    output = '';
    chosen = target.kind === 'tests' ? new Set(target.ids) : null;
    running = { target, args, startedAt: Date.now() };
    broadcast({ type: 'run', running });
    const h = options.startRun(args, events.env(), (stream, text) => {
      output = (output + text).slice(-OUTPUT_KEEP);
      broadcast({ type: 'output', stream, text });
    });
    handle = h;
    void h.exited.then(async (code) => {
      await events.drain();
      state.runnerExited(code);
      running = null;
      handle = null;
      broadcast({ type: 'run', running: null, exitCode: code, state: state.snapshot() });
      if (relistQueued) {
        relistQueued = false;
        void relist();
      }
    });
    return null;
  };

  // Test files changed: list again (debounced).
  let watchers: fs.FSWatcher[] = [];
  let relistTimer: NodeJS.Timeout | null = null;
  function watchFiles(): void {
    for (const w of watchers) w.close();
    watchers = [];
    const dirs = new Set((list?.files ?? []).map((f) => path.dirname(path.resolve(options.cwd, f))));
    for (const dir of dirs) {
      try {
        const w = fs.watch(dir, () => {
          if (relistTimer !== null) clearTimeout(relistTimer);
          relistTimer = setTimeout(() => void relist(), 400);
        });
        w.unref();
        watchers.push(w);
      } catch {
        // A directory that went away: the next listing drops it.
      }
    }
  }

  const allowedHost = (h: string | undefined) => h !== undefined && [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(h);
  const cookieToken = (req: http.IncomingMessage) => /(?:^|;\s*)quiesco_ui=([0-9a-f]+)/.exec(req.headers.cookie ?? '')?.[1];

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`);
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
    if (!allowedHost(req.headers.host)) {
      res.writeHead(403, headers).end('Forbidden host');
      return;
    }
    const queryToken = url.searchParams.get('token');
    const authorized = queryToken === token || cookieToken(req) === token;
    if (!authorized) {
      res.writeHead(401, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end('Open the URL quiesco ui printed (it carries the token).');
      return;
    }
    const setCookie = queryToken === token ? { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/` } : {};

    if (url.pathname === '/api/file' || url.pathname === '/api/source') {
      const p = url.searchParams.get('path') ?? '';
      const file = path.resolve(options.cwd, p);
      const ok =
        url.pathname === '/api/file'
          ? inside(options.artifactsDir, file)
          : (list?.files ?? []).some((f) => path.resolve(options.cwd, f) === file) && inside(options.cwd, file);
      if (!ok || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, headers).end('Not found');
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Type': fileType(file), 'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'" });
      fs.createReadStream(file).pipe(res);
      return;
    }

    const csp = `default-src 'self'; connect-src 'self' ws://${req.headers.host}; img-src 'self' data: blob:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'`;
    if (options.staticDir === null) {
      res.writeHead(200, { ...headers, ...setCookie, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp }).end('<!doctype html><title>Quiesco</title><p>Quiesco UI</p>');
      return;
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let file = path.join(options.staticDir, rel === '' ? 'index.html' : rel);
    if (!inside(options.staticDir, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(options.staticDir, 'index.html');
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { ...headers, ...setCookie, 'Content-Type': type, 'Content-Security-Policy': csp });
    fs.createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`);
    const origin = req.headers.origin;
    const originOk = origin === undefined || [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`].includes(origin);
    const tokenOk = url.searchParams.get('token') === token || cookieToken(req) === token;
    if (url.pathname !== '/ws' || !allowedHost(req.headers.host) || !originOk || !tokenOk) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.on('message', (data) => {
        let m: ClientMessage;
        try {
          m = JSON.parse(String(data)) as ClientMessage;
        } catch {
          return;
        }
        if (m.type === 'run') {
          const problem = run(m.target);
          if (problem !== null) send(ws, { type: 'notice', level: 'error', message: problem });
        } else if (m.type === 'cancel') {
          handle?.stop();
        } else if (m.type === 'list') {
          void relist();
        }
      });
      send(ws, { type: 'welcome', info, list, listing, state: state.snapshot(), running, output });
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port ?? 0, host, () => resolve());
  });
  port = (httpServer.address() as { port: number }).port;
  void relist();

  return {
    url: `http://${host === '127.0.0.1' ? '127.0.0.1' : host}:${port}/?token=${token}`,
    port,
    token,
    async close() {
      handle?.stop(2000);
      if (handle !== null) await handle.exited;
      for (const w of watchers) w.close();
      if (relistTimer !== null) clearTimeout(relistTimer);
      for (const ws of clients) ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await events.close();
    },
  };
}
