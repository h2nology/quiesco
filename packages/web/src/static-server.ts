/**
 * Static file server for `npx expo export --platform web` output (requirements.md §6.8).
 * Route resolution, in order: the file itself; `<path>.html` and `<path>/index.html` (Expo Router
 * static rendering writes one HTML file per route); otherwise `index.html` (SPA fallback).
 * Requests that resolve outside the root directory are rejected.
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** File to serve for a URL path, or null when the request escapes the root. */
export function resolveRequest(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return null;
  }
  const target = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  for (const candidate of [target, `${target}.html`, path.join(target, 'index.html')]) {
    if (isFile(candidate)) return candidate;
  }
  return path.join(root, 'index.html');
}

export async function startStaticServer(dir: string, port = 0): Promise<StaticServer> {
  const root = path.resolve(dir);
  if (!isFile(path.join(root, 'index.html'))) {
    throw new Error(`${root} has no index.html; build it with \`EXPO_PUBLIC_QUIESCO=1 npx expo export --platform web\``);
  }
  const server = http.createServer((req, res) => {
    const file = resolveRequest(root, req.url ?? '/');
    if (file === null || !isFile(file)) {
      res.writeHead(file === null ? 403 : 404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${actual}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
