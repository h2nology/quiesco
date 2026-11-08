import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveRequest, startStaticServer } from '../src/static-server';
import type { StaticServer } from '../src/static-server';

let root: string;
let server: StaticServer;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-static-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>home</h1>');
  fs.writeFileSync(path.join(root, 'todos.html'), '<h1>todos</h1>');
  fs.mkdirSync(path.join(root, 'settings'));
  fs.writeFileSync(path.join(root, 'settings', 'index.html'), '<h1>settings</h1>');
  fs.mkdirSync(path.join(root, '_expo'));
  fs.writeFileSync(path.join(root, '_expo', 'app.js'), 'console.log(1)');
  server = await startStaticServer(root);
});
afterAll(async () => server.close());

describe('static server', () => {
  it('resolves files, per-route html, directory index and the SPA fallback', () => {
    expect(resolveRequest(root, '/_expo/app.js')).toBe(path.join(root, '_expo', 'app.js'));
    expect(resolveRequest(root, '/todos')).toBe(path.join(root, 'todos.html'));
    expect(resolveRequest(root, '/settings?tab=1')).toBe(path.join(root, 'settings', 'index.html'));
    expect(resolveRequest(root, '/todos/42')).toBe(path.join(root, 'index.html'));
  });

  it('never leaves the root directory', () => {
    expect(resolveRequest(root, '/../../etc/passwd')).toBe(path.join(root, 'index.html')); // normalized inside root
    expect(resolveRequest(root, '/%2e%2e/%2e%2e/etc/passwd')).toBe(path.join(root, 'index.html'));
    expect(resolveRequest(root, '/%E0%A4%A')).toBeNull(); // malformed escape
  });

  it('serves with content types', async () => {
    const js = await fetch(`${server.url}/_expo/app.js`);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(await (await fetch(`${server.url}/todos`)).text()).toBe('<h1>todos</h1>');
    expect(await (await fetch(`${server.url}/deep/link`)).text()).toBe('<h1>home</h1>');
  });

  it('refuses a directory without index.html', async () => {
    await expect(startStaticServer(os.tmpdir() + '/does-not-exist')).rejects.toThrow(/no index.html/);
  });
});
