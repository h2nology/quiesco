// 6.10 spike server: slow responses in every shape the network tracker has to see.
//   GET /headers-slow?ms=N  headers and body after N ms
//   GET /body-slow?ms=N     headers + first chunk at once, the rest of the body after N ms
//   GET /sse?ms=N           event stream: headers after N ms, then one event per second (kept open)
//   WS  /ws?ms=N            WebSocket handshake answered after N ms, then an echo socket (kept open)
import crypto from 'node:crypto';
import http from 'node:http';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

export function startSpikeServer(port = 3011) {
  const log = [];
  const note = (m) => log.push(`${Date.now()} ${m}`);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const ms = Number(u.searchParams.get('ms') ?? 1500);
    note(`${req.method} ${u.pathname}`);
    if (u.pathname === '/headers-slow') {
      setTimeout(() => {
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        note('headers-slow done');
      }, ms);
    } else if (u.pathname === '/body-slow') {
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.write('{"part":"');
      res.flushHeaders();
      setTimeout(() => {
        res.end('one"}');
        note('body-slow done');
      }, ms);
    } else if (u.pathname === '/sse') {
      setTimeout(() => {
        res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        res.write('data: hello\n\n');
        note('sse open');
        const t = setInterval(() => res.write(`data: ${Date.now()}\n\n`), 1000);
        req.on('close', () => clearInterval(t));
      }, ms);
    } else {
      res.writeHead(404, CORS);
      res.end();
    }
  });
  server.on('upgrade', (req, socket) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const ms = Number(u.searchParams.get('ms') ?? 1500);
    note('ws upgrade');
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    setTimeout(() => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      note('ws open');
    }, ms);
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, log, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) })));
}
