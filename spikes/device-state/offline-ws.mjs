// 6.6 batch B check: does Playwright context.setOffline cut localhost WebSockets / fetch?
import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(new URL('../../packages/core/package.json', import.meta.url));
const { WebSocketServer } = require('ws');
const { chromium } = createRequire(new URL('../../packages/web/package.json', import.meta.url))('playwright');
const srv = http.createServer((q, s) => { s.setHeader('access-control-allow-origin', '*'); s.end('ok'); });
const wss = new WebSocketServer({ server: srv });
wss.on('connection', (ws) => ws.on('message', (m) => ws.send('echo:' + m)));
await new Promise((r) => srv.listen(0, r));
const port = srv.address().port;
const b = await chromium.launch(); const c = await b.newContext(); const p = await c.newPage();
await p.goto(`http://localhost:${port}/`);
await p.evaluate((port) => new Promise((r) => { const ws = new WebSocket(`ws://localhost:${port}`); window.ws = ws; window.log = []; ws.onmessage = (e) => log.push(e.data); ws.onclose = (e) => log.push('close ' + e.code); ws.onopen = r; }), port);
await c.setOffline(true);
const res = await p.evaluate(async (port) => {
  ws.send('a'); await new Promise((r) => setTimeout(r, 500));
  const f = await fetch(`http://localhost:${port}/x`).then((r) => 'fetch ok', (e) => 'fetch err ' + e.message);
  const n = await new Promise((r) => { const w = new WebSocket(`ws://localhost:${port}`); w.onopen = () => r('new ws open'); w.onerror = () => r('new ws error'); });
  return { log, f, n, onLine: navigator.onLine, state: ws.readyState };
}, port);
console.log(res);
await b.close(); srv.close();
