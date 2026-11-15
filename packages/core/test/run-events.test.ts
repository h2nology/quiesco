import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RunEvent } from '@quiesco/protocol';
import { RUN_EVENTS_ENV } from '@quiesco/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { RunEventServer, connectRunEvents, runEventsAddress } from '../src/run-events';

const test = { id: 'e2e/a.test.ts\u0000adds', file: 'e2e/a.test.ts', name: 'adds', path: ['adds'] };

let server: RunEventServer | null = null;
const received: { event: RunEvent; connection: number }[] = [];

async function start() {
  received.length = 0;
  server = new RunEventServer({ onEvent: (event, connection) => received.push({ event, connection }) });
  await server.listen();
  return server;
}

afterEach(async () => {
  await server?.close();
  server = null;
});

describe('runEventsAddress', () => {
  it('is a named pipe on Windows', () => {
    expect(runEventsAddress('win32')).toMatch(/^\\\\\.\\pipe\\quiesco-\d+-[0-9a-f]{8}$/);
  });

  it('falls back to /tmp when TMPDIR would make the socket path too long', () => {
    expect(runEventsAddress('darwin', '/short')).toMatch(/^\/short\/quiesco-/);
    expect(runEventsAddress('linux', `/${'x'.repeat(120)}`)).toMatch(/^\/tmp\/quiesco-\d+-[0-9a-f]{8}\.sock$/);
  });

  it('is different every time', () => {
    expect(runEventsAddress()).not.toBe(runEventsAddress());
  });
});

describe('RunEventServer + connectRunEvents', () => {
  it('a client without QUIESCO_EVENTS is disabled and sends nothing', async () => {
    const client = connectRunEvents({ runner: 'jest', env: {} });
    expect(client.enabled).toBe(false);
    client.send({ type: 'run:end', success: true, interrupted: false, durationMs: 0 });
    await client.close();
  });

  it('delivers hello and events in order, then drains when the client closes', async () => {
    const s = await start();
    const client = connectRunEvents({ runner: 'vitest', runnerVersion: '5.1.0', env: s.env() });
    client.send({ type: 'run:start', total: 2, totalIsEstimate: true, files: ['e2e/a.test.ts'], workers: 1 });
    client.send({ type: 'test:start', test, attempt: 0, startedAt: 1 });
    client.send({ type: 'test:end', test, status: 'passed', durationMs: 3, willRetry: false });
    await client.close();
    await s.drain();
    expect(received.map((r) => r.event.type)).toEqual(['hello', 'run:start', 'test:start', 'test:end']);
    expect(received[0]?.event).toMatchObject({ type: 'hello', runner: 'vitest', runnerVersion: '5.1.0', protocol: 1, pid: process.pid });
    expect(s.hellos).toEqual([{ runner: 'vitest', protocol: 1, connection: 1 }]);
    expect(s.connections).toBe(0);
  });

  it('keeps several connections apart (reporter + a worker sending evidence)', async () => {
    const s = await start();
    const reporter = connectRunEvents({ runner: 'jest', env: s.env() });
    const worker = connectRunEvents({ runner: 'jest', env: s.env() });
    worker.send({ type: 'test:evidence', testId: test.id, files: ['/abs/shot.png'] });
    reporter.send({ type: 'run:end', success: false, interrupted: false, durationMs: 9 });
    await Promise.all([reporter.close(), worker.close()]);
    await s.drain();
    const byConnection = new Map<number, string[]>();
    for (const r of received) byConnection.set(r.connection, [...(byConnection.get(r.connection) ?? []), r.event.type]);
    expect([...byConnection.values()].sort()).toEqual([
      ['hello', 'run:end'],
      ['hello', 'test:evidence'],
    ]);
  });

  it('receives everything a child process sends before it exits (through a separate process)', async () => {
    const s = await start();
    const child = path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'run-events-child.mjs');
    const code = await new Promise<number | null>((resolve) => {
      const p = spawn(process.execPath, [child, '500'], { env: { ...process.env, ...s.env() }, stdio: ['ignore', 'ignore', 'inherit'] });
      p.on('exit', resolve);
    });
    expect(code).toBe(0);
    await s.drain();
    expect(received.filter((r) => r.event.type === 'test:end')).toHaveLength(500);
    expect(received.at(-1)?.event.type).toBe('run:end');
  });

  it('a client whose server is gone warns once and does not throw', async () => {
    const warnings: string[] = [];
    const client = connectRunEvents({ runner: 'cucumber', env: { [RUN_EVENTS_ENV]: runEventsAddress() }, warn: (m) => warnings.push(m) });
    client.send({ type: 'test:start', test, attempt: 0, startedAt: 1 });
    await new Promise<void>((resolve) => {
      const check = () => (client.enabled ? setImmediate(check) : resolve());
      check();
    });
    client.send({ type: 'test:start', test, attempt: 0, startedAt: 2 });
    await client.close();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/run events are not sent/);
  });

  it('skips invalid lines and reports them', async () => {
    const invalid: string[] = [];
    server = new RunEventServer({ onEvent: (event, connection) => received.push({ event, connection }), onInvalid: (line) => invalid.push(line) });
    received.length = 0;
    await server.listen();
    const net = await import('node:net');
    const raw = net.createConnection(server.address);
    raw.end('garbage\n{"type":"run:end","success":true,"interrupted":false,"durationMs":1}');
    await new Promise((r) => raw.on('close', r));
    await server.drain();
    expect(invalid).toEqual(['garbage']);
    expect(received.map((r) => r.event.type)).toEqual(['run:end']);
  });

  it.runIf(process.platform !== 'win32')('the socket file is private to the user and removed on close', async () => {
    const s = await start();
    expect(statSync(s.address).mode & 0o777).toBe(0o600);
    await s.close();
    server = null;
    expect(existsSync(s.address)).toBe(false);
  });

  it('drain() returns at once without connections and gives up after the timeout', async () => {
    const s = await start();
    await s.drain(10);
    const client = connectRunEvents({ runner: 'jest', env: s.env() });
    await new Promise<void>((resolve) => {
      const check = () => (s.connections > 0 ? resolve() : setImmediate(check));
      check();
    });
    const t = Date.now();
    await s.drain(50);
    expect(Date.now() - t).toBeGreaterThanOrEqual(40);
    await client.close();
  });
});
