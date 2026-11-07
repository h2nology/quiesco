import { afterEach, describe, expect, it } from 'vitest';

import { QuiescoServer } from '../src/server/ws-server';
import { AGENT_CONFIG, NO_REPLY, connectAgent } from './helpers/fake-agent';

let server: QuiescoServer | null = null;
async function start() {
  server = new QuiescoServer({ port: 0, host: '127.0.0.1', agentConfig: AGENT_CONFIG });
  const port = await server.start();
  return { server, port };
}
afterEach(async () => {
  await server?.stop();
  server = null;
});

describe('QuiescoServer handshake', () => {
  it('accepts a known session and sends the agent config', async () => {
    const { server, port } = await start();
    server.expectSession('s1');
    const agent = connectAgent(port, { sessionId: 's1' });
    expect(await agent.hello).toEqual({ result: { accepted: true, sessionId: 's1', config: AGENT_CONFIG }, error: undefined });
    const conn = await server.waitForConnection('s1', 1000, () => 'timeout');
    expect(conn.info).toMatchObject({ platform: 'android', nativeModule: false });
  });

  it('maps an anonymous agent (JS-only build) to the single session that accepts it', async () => {
    const { server, port } = await start();
    server.expectSession('s1', { acceptAnonymous: true });
    const agent = connectAgent(port, { sessionId: null });
    expect((await agent.hello).result?.sessionId).toBe('s1');
  });

  it('refuses unknown sessions (4001) and wrong protocol versions (4002) with structured errors', async () => {
    const { server, port } = await start();
    server.expectSession('s1');
    const stranger = connectAgent(port, { sessionId: 'other' });
    expect((await stranger.hello).error).toMatchObject({ code: 1010, data: { name: 'SESSION_MISMATCH', expected: ['s1'], received: 'other' } });
    expect((await stranger.closed).code).toBe(4001);
    const anonymous = connectAgent(port, { sessionId: null }); // s1 does not accept anonymous agents
    expect((await anonymous.closed).code).toBe(4001);
    const old = connectAgent(port, { sessionId: 's1', protocolVersion: 0 });
    expect((await old.hello).error).toMatchObject({ code: 1009, message: expect.stringMatching(/Upgrade @quiesco\/agent/) });
    expect((await old.closed).code).toBe(4002);
    expect(server.rejected).toHaveLength(3);
  });

  it('replaces an older connection of the same session (4003)', async () => {
    const { server, port } = await start();
    server.expectSession('s1');
    const first = connectAgent(port, { sessionId: 's1' });
    await first.hello;
    const c1 = await server.waitForConnection('s1', 1000, () => '');
    const second = connectAgent(port, { sessionId: 's1' });
    await second.hello;
    expect((await first.closed).code).toBe(4003);
    const c2 = await server.waitForConnection('s1', 1000, () => '', c1);
    expect(c2).not.toBe(c1);
    expect(c1.closed).toBe(true);
  });

  it('times out waiting for a connection with the given description', async () => {
    const { server } = await start();
    server.expectSession('s1');
    await expect(server.waitForConnection('s1', 50, () => 'nobody came')).rejects.toMatchObject({ errorName: 'CONNECT_TIMEOUT', message: 'nobody came' });
  });
});

describe('AgentConnection', () => {
  it('sends requests and maps results and agent errors', async () => {
    const { server, port } = await start();
    server.expectSession('s1');
    connectAgent(port, {
      sessionId: 's1',
      handler: (method) => {
        if (method === 'getTree') return { root: null };
        throw { code: 1001, message: 'No element matches { id: "x" }', data: { name: 'ELEMENT_NOT_FOUND', matcher: { id: 'x' } } };
      },
    });
    const conn = await server.waitForConnection('s1', 1000, () => '');
    await expect(conn.request('getTree', {}, 1000)).resolves.toEqual({ root: null });
    await expect(conn.request('query', { matcher: { id: 'x' } }, 1000)).rejects.toMatchObject({
      errorName: 'ELEMENT_NOT_FOUND',
      code: 1001,
      data: { matcher: { id: 'x' } },
    });
  });

  it('fails a request when the agent does not answer in time, and when it disconnects', async () => {
    const { server, port } = await start();
    server.expectSession('s1');
    const agent = connectAgent(port, { sessionId: 's1', handler: () => NO_REPLY });
    const conn = await server.waitForConnection('s1', 1000, () => '');
    await expect(conn.request('waitForIdle', {}, 50)).rejects.toMatchObject({ errorName: 'AGENT_TIMEOUT', message: expect.stringMatching(/JS thread may be blocked/) });
    const pending = conn.request('waitForIdle', {}, 5000);
    agent.ws.terminate();
    await expect(pending).rejects.toMatchObject({ errorName: 'AGENT_DISCONNECTED' });
    await expect(conn.request('getTree', {}, 100)).rejects.toMatchObject({ errorName: 'AGENT_DISCONNECTED' });
  });

  it('emits log and app error events', async () => {
    const { server, port } = await start();
    server.expectSession('s1');
    const agent = connectAgent(port, { sessionId: 's1' });
    const conn = await server.waitForConnection('s1', 1000, () => '');
    const seen = new Promise<unknown[]>((resolve) => {
      const got: unknown[] = [];
      conn.on('log', (l) => got.push(l.message));
      conn.on('appError', (e) => {
        got.push(e.kind);
        resolve(got);
      });
    });
    agent.notify('log', { level: 'warn', message: 'hi', timestamp: 1 });
    agent.notify('error', { kind: 'uncaught', message: 'boom', timestamp: 2 });
    expect(await seen).toEqual(['hi', 'uncaught']);
  });
});
