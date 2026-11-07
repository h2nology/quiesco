// Phase 0 / S5 spike: start a WS server, wait for the agent's hello with the expected session,
// send one JSON-RPC ping, print the round trip, exit 0. Exit 1 on timeout.
// usage: node ws-host.mjs <port> <session> [timeoutMs]
import { WebSocketServer } from 'ws';

const [port, session, timeoutMs = '60000'] = process.argv.slice(2);
const t0 = Date.now();
const wss = new WebSocketServer({ port: Number(port) });
console.log(`[host] listening :${port} session=${session}`);
const timer = setTimeout(() => {
  console.log(`[host] TIMEOUT after ${timeoutMs}ms, no hello`);
  process.exit(1);
}, Number(timeoutMs));

wss.on('connection', (ws, req) => {
  console.log(`[host] connection from ${req.socket.remoteAddress} after ${Date.now() - t0}ms`);
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.method === 'hello') {
      const ok = msg.params.session === session;
      console.log(`[host] hello ${JSON.stringify(msg.params)} sessionMatch=${ok}`);
      if (!ok) return ws.close(4001, 'session mismatch');
      const sent = Date.now();
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
      ws.once('message', (r) => {
        console.log(`[host] ping roundtrip=${Date.now() - sent}ms reply=${String(r)}`);
        clearTimeout(timer);
        ws.close(1000, 'done');
        wss.close(() => process.exit(0));
      });
    }
  });
});
