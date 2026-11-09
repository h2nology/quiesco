// Phase 6.6 spike on the web (Chromium via Playwright): offline, color scheme, viewport swap,
// geolocation, clipboard. Usage: node web-device.mjs
import http from 'node:http';
import { chromium } from 'playwright';

const server = http.createServer((_q, r) => r.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title><script>window.ev=[];' +
  "addEventListener('offline',()=>ev.push('offline'));addEventListener('online',()=>ev.push('online'));" +
  "addEventListener('resize',()=>ev.push('resize '+innerWidth+'x'+innerHeight));" +
  "matchMedia('(prefers-color-scheme: dark)').addEventListener('change',e=>ev.push('dark '+e.matches));</script>"));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
const page = await context.newPage();
await page.goto(url);
const state = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).then(() => page.evaluate(() => ({ onLine: navigator.onLine, dark: matchMedia('(prefers-color-scheme: dark)').matches, size: `${innerWidth}x${innerHeight}`, ev: ev.splice(0) })));

await context.setOffline(true);
console.log('offline:', await state(), await page.evaluate((u) => fetch(u).then((r) => 'status ' + r.status, (e) => 'error ' + e.message), url));
await context.setOffline(false);
console.log('online:', await state());

await page.emulateMedia({ colorScheme: 'dark' });
console.log('dark:', await state());
await page.emulateMedia({ colorScheme: 'light' });

await page.setViewportSize({ width: 844, height: 390 });
console.log('landscape:', await state(), 'screen.orientation', await page.evaluate(() => screen.orientation?.type));
await page.setViewportSize({ width: 390, height: 844 });

await context.grantPermissions(['geolocation'], { origin: url.slice(0, -1) });
await context.setGeolocation({ latitude: 35.68, longitude: 139.76 });
console.log('geolocation:', await page.evaluate(() => new Promise((r) => navigator.geolocation.getCurrentPosition((p) => r([p.coords.latitude, p.coords.longitude]), (e) => r('error ' + e.message)))));
await context.setGeolocation({ latitude: 34.69, longitude: 135.5 });
console.log('geolocation moved:', await page.evaluate(() => new Promise((r) => navigator.geolocation.getCurrentPosition((p) => r([p.coords.latitude, p.coords.longitude])))));
await context.clearPermissions();
console.log('after clearPermissions:', await page.evaluate(() => navigator.permissions.query({ name: 'geolocation' }).then((s) => s.state)));

await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.slice(0, -1) });
console.log('clipboard:', await page.evaluate(() => navigator.clipboard.writeText('クリップ').then(() => navigator.clipboard.readText()), null).catch((e) => 'error ' + e.message));
await browser.close();
server.close();
