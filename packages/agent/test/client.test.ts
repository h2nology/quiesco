import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentClient, MethodNotFound } from '../src/connection/client';
import { QuiescoError } from '../src/errors';
import type { Clock } from '../src/sync';
import { CONFIG, FakeSocket, acceptHello } from './helpers/fake-socket';

const clock: Clock = { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (id) => clearTimeout(id as number), now: () => Date.now() };

function setup(handle: (m: string, p: unknown) => Promise<unknown> = async () => ({ ok: true })) {
  const sockets: FakeSocket[] = [];
  const onReady = vi.fn();
  const client = new AgentClient({
    params: { port: 7400, session: 'sess', source: 'native' },
    hello: { platform: 'android', agentVersion: '0.0.0', nativeModule: false },
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    handle,
    onReady,
    clock,
  });
  return { client, sockets, onReady, last: () => sockets[sockets.length - 1]! };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('AgentClient', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('connects to localhost:<port> and sends hello with session and protocol version', () => {
    const { client, last } = setup();
    client.start();
    expect(last().url).toBe('ws://localhost:7400');
    last().open();
    expect(last().sent[0]).toEqual({
      jsonrpc: '2.0',
      id: 'hello',
      method: 'hello',
      params: { platform: 'android', agentVersion: '0.0.0', nativeModule: false, sessionId: 'sess', protocolVersion: 1 },
    });
    expect(client.state).toBe('handshaking');
  });

  it('becomes ready on the hello result, passes the config, and flushes buffered events', () => {
    const { client, last, onReady } = setup();
    client.notify('log', { level: 'warn', message: 'early', timestamp: 1 });
    client.start();
    acceptHello(last());
    expect(client.state).toBe('ready');
    expect(onReady).toHaveBeenCalledWith(CONFIG);
    expect(last().sent[1]).toMatchObject({ method: 'log', params: { message: 'early' } });
    client.notify('error', { kind: 'uncaught', message: 'x', timestamp: 2 });
    expect(last().sent[2]).toMatchObject({ method: 'error' });
  });

  it('answers requests with result, Quiesco errors, METHOD_NOT_FOUND and INTERNAL_ERROR', async () => {
    const { client, last } = setup(async (m) => {
      if (m === 'ok') return { fine: 1 };
      if (m === 'q') throw new QuiescoError('ELEMENT_NOT_FOUND', 'nope', { matcher: { id: 'a' } });
      if (m === 'bug') throw new TypeError('oops');
      throw new MethodNotFound(m);
    });
    client.start();
    acceptHello(last());
    for (const [id, method] of [[1, 'ok'], [2, 'q'], [3, 'bug'], [4, 'zzz']] as const) last().receive({ jsonrpc: '2.0', id, method, params: {} });
    await flush();
    const byId = Object.fromEntries(last().sent.filter((m) => typeof m['id'] === 'number').map((m) => [m['id'], m]));
    expect(byId[1]).toEqual({ jsonrpc: '2.0', id: 1, result: { fine: 1 } });
    expect(byId[2]).toMatchObject({ error: { code: 1001, data: { name: 'ELEMENT_NOT_FOUND', matcher: { id: 'a' } } } });
    expect(byId[3]).toMatchObject({ error: { code: -32603, message: 'agent error: oops' } });
    expect(byId[4]).toMatchObject({ error: { code: -32601 } });
  });

  it('replies PARSE_ERROR to invalid JSON', () => {
    const { client, last } = setup();
    client.start();
    acceptHello(last());
    last().receive('{not json');
    expect(last().sent.at(-1)).toMatchObject({ id: null, error: { code: -32700 } });
  });

  it('reconnects with backoff after an unexpected close', () => {
    const { client, sockets } = setup();
    client.start();
    sockets[0]!.drop();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(250);
    expect(sockets).toHaveLength(2);
    sockets[1]!.drop();
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    acceptHello(sockets[2]!);
    sockets[2]!.drop();
    vi.advanceTimersByTime(250); // backoff reset after a successful handshake
    expect(sockets).toHaveLength(4);
  });

  it('does not reconnect after session / protocol mismatch or replacement', () => {
    for (const code of [4001, 4002, 4003]) {
      const { client, sockets } = setup();
      client.start();
      sockets[0]!.open();
      sockets[0]!.drop(code, 'rejected');
      vi.advanceTimersByTime(5000);
      expect(sockets).toHaveLength(1);
      expect(client.state).toBe('rejected');
    }
  });

  it('stop() closes the socket and cancels a pending reconnect', () => {
    const { client, sockets } = setup();
    client.start();
    sockets[0]!.drop();
    client.stop();
    vi.advanceTimersByTime(5000);
    expect(sockets).toHaveLength(1);
    client.start();
    expect(sockets).toHaveLength(2);
    client.stop();
    expect(sockets[1]!.closed).toEqual({ code: 1000, reason: 'agent stopped' });
  });
});
