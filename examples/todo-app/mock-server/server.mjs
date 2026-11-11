// Local mock backend for the example app.
// - MOCK_DELAY_MS delays every response (acceptance: "add a 2 s network delay, the tests still pass unchanged").
// - MOCK_STALL="POST /login" never answers that route (acceptance: a sync timeout names the pending request).
// - GET /slow-body answers the headers at once and the body SLOW_MS later; WS /ws answers the WebSocket
//   handshake SLOW_MS later (Phase 6.10: the network tracker waits for the body and the handshake).
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

/** @param {{ port?: number; delayMs?: number; stall?: string }} [options] */
const SLOW_MS = 800;

export function startMockServer(options = {}) {
  const port = options.port ?? Number(process.env.MOCK_PORT ?? 3001);
  const delayMs = options.delayMs ?? Number(process.env.MOCK_DELAY_MS ?? 0);
  const stall = options.stall ?? process.env.MOCK_STALL ?? '';
  /** @type {{ id: string; title: string }[]} */
  let todos = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (status, data) => {
        setTimeout(() => {
          res.writeHead(status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
          });
          res.end(JSON.stringify(data));
        }, req.method === 'OPTIONS' ? 0 : delayMs);
      };
      const json = body === '' ? {} : JSON.parse(body);
      const route = `${req.method} ${req.url}`;
      if (route === stall) return; // never answer
      if (route === 'GET /slow-body') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.write('{"items":[1,2,');
        res.flushHeaders();
        setTimeout(() => res.end('3]}'), SLOW_MS);
        return;
      }
      switch (route) {
        case 'OPTIONS /login':
        case 'OPTIONS /todos':
          return send(204, null);
        case 'POST /login':
          return json.email ? send(200, { email: json.email, token: randomUUID() }) : send(400, { error: 'email required' });
        case 'GET /todos':
          return send(200, todos);
        case 'POST /todos': {
          const todo = { id: randomUUID(), title: String(json.title ?? '') };
          todos = [todo, ...todos];
          return send(201, todo);
        }
        case 'PUT /todos':
          todos = (json.titles ?? []).map((title) => ({ id: randomUUID(), title: String(title) }));
          return send(200, todos);
        default:
          return send(404, { error: `no route ${route}` });
      }
    });
  });

  /** Upgraded sockets leave the server's connection list: close() must end them itself. */
  const upgraded = new Set();
  server.on('upgrade', (req, socket) => {
    upgraded.add(socket);
    socket.on('close', () => upgraded.delete(socket));
    socket.on('error', () => undefined);
    if (req.url !== '/ws') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    setTimeout(() => {
      if (!socket.destroyed) socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    }, SLOW_MS);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () =>
      resolve({
        port,
        delayMs,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections();
            upgraded.forEach((s) => s.destroy());
            server.close(() => r(undefined));
          }),
      }),
    );
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startMockServer();
  console.log(`mock server on http://localhost:${s.port} (delay ${s.delayMs}ms)`);
}
