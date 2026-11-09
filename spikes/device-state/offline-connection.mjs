// 6.6 batch B: does CDP Network.overrideNetworkState fire navigator.connection 'change' (NetInfo web listens to it)?
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../../packages/web/package.json', import.meta.url))('playwright');
const b = await chromium.launch(); const c = await b.newContext(); const p = await c.newPage();
await p.goto('data:text/html,<p>x</p>');
await p.evaluate(() => { window.log = []; navigator.connection.addEventListener('change', () => log.push(['change', navigator.onLine, navigator.connection.downlink, navigator.connection.rtt, navigator.connection.effectiveType])); addEventListener('offline', () => log.push('offline')); addEventListener('online', () => log.push('online')); });
const cdp = await c.newCDPSession(p);
for (const [label, params] of [
  ['offline -1', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }],
  ['online -1', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }],
  ['offline 0', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }],
  ['online -1 again', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }],
]) {
  await cdp.send('Network.overrideNetworkState', params);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  console.log(label, JSON.stringify(await p.evaluate(() => { const l = log; window.log = []; return l; })), await p.evaluate(() => navigator.onLine));
}
await b.close();
