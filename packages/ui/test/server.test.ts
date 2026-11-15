import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import type { TestList } from '@quiesco/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import type { ClientMessage, ServerMessage } from '../src/messages';
import { startUiServer } from '../src/server';
import type { UiServer } from '../src/server';
import { spawnRun } from '../src/spawn';

const fakeRunner = path.join(__dirname, 'helpers', 'fake-runner.mjs');

const list: TestList = {
  runner: 'cucumber',
  files: ['a.feature'],
  tests: [
    { id: 'a.feature:3', file: 'a.feature', line: 3, name: 'test a.feature:3', path: ['test a.feature:3'] },
    { id: 'a.feature:9', file: 'a.feature', line: 9, name: 'test a.feature:9', path: ['test a.feature:9'] },
  ],
  errors: [],
};

let server: UiServer | null = null;
let project = '';
afterEach(async () => {
  await server?.close();
  server = null;
});

async function start(opts: { hang?: boolean } = {}) {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-ui-'));
  fs.writeFileSync(path.join(project, 'a.feature'), 'Feature: A\n');
  fs.mkdirSync(path.join(project, 'artifacts', 'x'), { recursive: true });
  fs.writeFileSync(path.join(project, 'artifacts', 'x', 'failure.png'), 'PNG');
  fs.writeFileSync(path.join(project, 'secret.txt'), 'secret');
  const runs: string[][] = [];
  server = await startUiServer({
    cwd: project,
    runner: 'cucumber',
    platform: 'web',
    artifactsDir: path.join(project, 'artifacts'),
    staticDir: null,
    listTests: async () => list,
    startRun: (args, env, onOutput) => {
      runs.push(args);
      return spawnRun(process.execPath, [fakeRunner, ...args, ...(opts.hang === true ? ['--hang'] : [])], { cwd: project, env: { ...process.env, ...env, FAKE_SIBLING: '1' }, onOutput });
    },
  });
  return { server, runs };
}

/** A WebSocket client that records messages and can wait for one. */
function connect(s: UiServer, opts: { origin?: string; token?: string } = {}) {
  const messages: ServerMessage[] = [];
  const waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=${opts.token ?? s.token}`, { origin: opts.origin ?? `http://127.0.0.1:${s.port}` });
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as ServerMessage;
    messages.push(m);
    for (const w of waiters.splice(0)) if (w.pred(m)) w.resolve(m);
    else waiters.push(w);
  });
  const next = <T extends ServerMessage>(pred: (m: ServerMessage) => m is T) =>
    new Promise<T>((resolve) => {
      const found = messages.find(pred);
      if (found !== undefined) resolve(found);
      else waiters.push({ pred, resolve: resolve as (m: ServerMessage) => void });
    });
  const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
  const opened = new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  return { ws, messages, next, send, opened };
}

const isRunEnd = (m: ServerMessage): m is Extract<ServerMessage, { type: 'run' }> => m.type === 'run' && m.running === null;
const isListDone = (m: ServerMessage): m is Extract<ServerMessage, { type: 'list' }> => (m.type === 'list' || m.type === 'welcome') && !m.listing && m.list !== null;

describe('quiesco ui server', () => {
  it('welcomes a page with the info and the test list, runs chosen tests and streams their events', async () => {
    const { server: s, runs } = await start();
    const c = connect(s);
    await c.opened;
    const welcome = await c.next((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
    expect(welcome.info).toMatchObject({ runner: 'cucumber', platform: 'web', project: path.basename(project) });
    await c.next(isListDone);

    c.send({ type: 'run', target: { kind: 'tests', ids: ['a.feature:9', 'a.feature:3'] } });
    const started = await c.next((m): m is Extract<ServerMessage, { type: 'run' }> => m.type === 'run' && m.running !== null);
    expect(started.running?.args).toEqual(['a.feature:3:9']);
    const ended = await c.next(isRunEnd);
    expect(runs).toEqual([['a.feature:3:9']]);
    expect(ended.exitCode).toBe(1);
    expect(ended.state?.counts).toMatchObject({ passed: 1, failed: 1 });
    expect(ended.state?.tests.find((t) => t.test.id === 'a.feature:9')).toMatchObject({ status: 'failed', evidence: ['/artifacts/x/failure.png'] });
    // The file's other test, reported skipped by the runner's filter, is not taken as a result.
    expect(ended.state?.tests.some((t) => t.test.id === 'a.feature:20')).toBe(false);
    expect(ended.state?.counts.skipped).toBe(0);
    expect(c.messages.find((m) => m.type === 'event' && m.event.type === 'run:start')).toMatchObject({ event: { total: 2, totalIsEstimate: false } });
    const types = c.messages.map((m) => (m.type === 'event' ? m.event.type : m.type));
    expect(types).toEqual(expect.arrayContaining(['output', 'hello', 'run:start', 'test:start', 'test:end', 'test:evidence', 'run:end']));
    expect(c.messages.some((m) => m.type === 'output' && m.text.includes('fake runner: a.feature:3:9'))).toBe(true);
    c.ws.close();
  });

  it('a whole-file run keeps every result the runner reports', async () => {
    const { server: s } = await start();
    const c = connect(s);
    await c.opened;
    await c.next(isListDone);
    c.send({ type: 'run', target: { kind: 'file', file: 'a.feature' } });
    const ended = await c.next(isRunEnd);
    expect(ended.state?.tests.find((t) => t.test.id === 'a.feature:20')?.status).toBe('skipped');
    c.ws.close();
  });

  it('one run at a time; cancel stops the run; a page that connects mid-run gets the state so far', async () => {
    const { server: s } = await start({ hang: true });
    const c = connect(s);
    await c.opened;
    await c.next(isListDone);
    c.send({ type: 'run', target: { kind: 'all' } });
    await c.next((m): m is Extract<ServerMessage, { type: 'event' }> => m.type === 'event' && m.event.type === 'test:start');
    c.send({ type: 'run', target: { kind: 'all' } });
    const busy = await c.next((m): m is Extract<ServerMessage, { type: 'notice' }> => m.type === 'notice');
    expect(busy).toMatchObject({ code: 'busy', message: expect.stringMatching(/already in progress/) });

    const late = connect(s);
    await late.opened;
    const welcome = await late.next((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
    expect(welcome.running?.target).toEqual({ kind: 'all' });
    expect(welcome.state.running.map((r) => r.test.id)).toEqual(['a.feature:3']);
    expect(welcome.output).toContain('fake runner: (all)');

    c.send({ type: 'cancel' });
    const ended = await late.next(isRunEnd);
    expect(ended.exitCode).toBe(130);
    expect(ended.state).toMatchObject({ phase: 'ended', interrupted: true });
    c.ws.close();
    late.ws.close();
  });

  it('refuses a missing token, a foreign Origin and a foreign Host', async () => {
    const { server: s } = await start();
    await expect(connect(s, { token: 'wrong' }).opened).rejects.toThrow(/403/);
    await expect(connect(s, { origin: 'http://evil.example' }).opened).rejects.toThrow(/403/);
    expect((await fetch(`http://127.0.0.1:${s.port}/`)).status).toBe(401);
    // fetch() does not let a page set Host; a DNS-rebinding page would send its own name.
    const foreign = await new Promise<number>((resolve) => http.get({ host: '127.0.0.1', port: s.port, path: `/?token=${s.token}`, headers: { host: 'evil.example' } }, (res) => resolve(res.statusCode ?? 0)));
    expect(foreign).toBe(403);
    const page = await fetch(`http://127.0.0.1:${s.port}/?token=${s.token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('set-cookie')).toMatch(/^quiesco_ui=[0-9a-f]+; HttpOnly; SameSite=Strict/);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('serves evidence only from the artifacts directory and source only for listed test files', async () => {
    const { server: s } = await start();
    const c = connect(s);
    await c.opened;
    await c.next(isListDone);
    const get = (p: string, kind = 'file') => fetch(`http://127.0.0.1:${s.port}/api/${kind}?token=${s.token}&path=${encodeURIComponent(p)}`);
    const shot = await get(path.join(project, 'artifacts', 'x', 'failure.png'));
    expect(shot.status).toBe(200);
    expect(shot.headers.get('content-type')).toBe('image/png');
    expect((await get(path.join(project, 'secret.txt'))).status).toBe(404);
    expect((await get(path.join(project, 'artifacts', '..', 'secret.txt'))).status).toBe(404);
    expect((await get('a.feature', 'source')).status).toBe(200);
    expect(await (await get('a.feature', 'source')).text()).toBe('Feature: A\n');
    expect((await get('secret.txt', 'source')).status).toBe(404);
    c.ws.close();
  });
});
