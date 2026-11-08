import net from 'node:net';

import { describe, expect, it } from 'vitest';

import { attachToRunningApp } from '../src/attach';
import { connectAgent } from './helpers/fake-agent';

async function freePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const { port } = srv.address() as net.AddressInfo;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

describe('attachToRunningApp', () => {
  it('waits for any agent on the configured port and reads its element tree', async () => {
    const port = await freePort();
    const tree = { type: 'View', testID: 'root', children: [] };
    let listening = -1;
    const app = await attachToRunningApp({
      config: { apps: {}, server: { port, host: '127.0.0.1' } },
      timeoutMs: 5000,
      onListening: (p) => {
        listening = p;
        // An app launched by an earlier run reconnects with its own session id.
        connectAgent(p, { sessionId: 'old-run', handler: (m) => (m === 'getTree' ? { root: tree } : {}) });
      },
    });
    expect(listening).toBe(port);
    expect(app.port).toBe(port);
    expect(app.platform).toBe('android');
    expect(await app.getTree()).toEqual(tree);
    await app.close();
  });

  it('times out with a hint when no app connects, and frees the port', async () => {
    const port = await freePort();
    await expect(attachToRunningApp({ config: { apps: {}, server: { port, host: '127.0.0.1' } }, timeoutMs: 100 })).rejects.toThrow(/No app connected .* --launch/);
    const again = attachToRunningApp({ config: { apps: {}, server: { port, host: '127.0.0.1' } }, timeoutMs: 100 });
    await expect(again).rejects.toThrow(/No app connected/);
  });
});
