// 6.6 batch B: per-URL offline via CDP (keep the Quiesco socket), navigator.onLine via overrideNetworkState
import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(new URL('../../packages/core/package.json', import.meta.url));
const { WebSocketServer } = require('ws');
const { chromium } = createRequire(new URL('../../packages/web/package.json', import.meta.url))('playwright');
const mk = async () => { const s = http.createServer((q, r) => { r.setHeader('access-control-allow-origin', '*'); r.end('ok'); }); const w = new WebSocketServer({ server: s }); w.on('connection', (ws) => ws.on('message', (m) => ws.send('echo:' + m))); await new Promise((r) => s.listen(0, r)); return s; };
const quiesco = await mk(); const api = await mk();
const qp = quiesco.address().port, ap = api.address().port;
const b = await chromium.launch(); const c = await b.newContext(); const p = await c.newPage();
await p.goto(`http://localhost:${ap}/`);
await p.evaluate((qp) => new Promise((r) => { const ws = new WebSocket(`ws://localhost:${qp}`); window.ws = ws; window.log = []; ws.onmessage = (e) => log.push(e.data); ws.onopen = r; window.addEventListener('offline', () => log.push('offline-event')); window.addEventListener('online', () => log.push('online-event')); }), qp);
const cdp = await c.newCDPSession(p);
await cdp.send('Network.enable');
const off = { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
if (process.env.RULE) try {
  const r = await cdp.send('Network.emulateNetworkConditionsByRule', { offline: true, matchedNetworkConditions: [{ urlPattern: '', ...off }] });
  console.log('byRule', r);
} catch (e) { console.log('byRule err', e.message); }
try { await cdp.send('Network.overrideNetworkState', off); console.log('overrideNetworkState ok'); } catch (e) { console.log('override err', e.message); }
const run = () => p.evaluate(async ({ qp, ap }) => {
  ws.send('a'); await new Promise((r) => setTimeout(r, 300));
  const f = (u) => fetch(u).then(() => 'ok', (e) => 'err ' + e.message);
  const nws = (u) => new Promise((r) => { const w = new WebSocket(u); w.onopen = () => { r('open'); w.close(); }; w.onerror = () => r('error'); });
  return { log: [...log], api: await f(`http://localhost:${ap}/x`), quiescoHttp: await f(`http://localhost:${qp}/x`), newApiWs: await nws(`ws://localhost:${ap}`), newQWs: await nws(`ws://localhost:${qp}`), onLine: navigator.onLine };
}, { qp, ap });
console.log('offline:', await run());
await cdp.send('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: [] }).catch((e) => console.log(e.message));
await cdp.send('Network.overrideNetworkState', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch((e) => console.log(e.message));
console.log('online:', await run());
await b.close(); quiesco.close(); api.close();
