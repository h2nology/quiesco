// Drives a real headless Chromium (requires `npx playwright install chromium`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WebProvider } from '../src/provider';

const PAGE = `<!doctype html><html><body style="margin:0">
<button id="b" style="position:absolute;left:10px;top:10px;width:100px;height:40px">tap</button>
<input id="i" style="position:absolute;left:10px;top:80px;width:200px;height:30px" value="old">
<div id="s" style="position:absolute;left:0;top:150px;width:300px;height:100px;overflow:auto"><div style="height:1000px">x</div></div>
<select id="sel" style="position:absolute;left:10px;top:300px;width:120px;height:30px"><option value="a">A</option><option value="b">B</option></select>
<input id="d" type="date" style="position:absolute;left:10px;top:350px;width:160px;height:30px">
<div id="t" style="position:absolute;left:0;top:400px;width:300px;height:200px"></div>
<script>
  window.log = [];
  const b = document.getElementById('b');
  b.addEventListener('click', (e) => log.push('click:' + e.detail));
  b.addEventListener('touchstart', () => log.push('touch'));
  b.addEventListener('pointerdown', () => log.push('down'));
  b.addEventListener('pointerup', () => log.push('up'));
  document.getElementById('sel').addEventListener('change', (e) => log.push('select:' + e.target.value));
  document.getElementById('d').addEventListener('input', (e) => log.push('date:' + e.target.value));
  window.touchLog = [];
  for (const type of ['touchstart', 'touchmove', 'touchend']) {
    document.getElementById('t').addEventListener(type, (e) => touchLog.push(type + ':' + e.touches.length));
  }
</script></body></html>`;

let dir: string;
let provider: WebProvider;

async function evaluate<T>(fn: string): Promise<T> {
  const page = (provider as unknown as { page: { evaluate(f: string): Promise<T> } }).page;
  return page.evaluate(fn);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-web-'));
  fs.writeFileSync(path.join(dir, 'index.html'), PAGE);
  provider = new WebProvider({ app: { distDir: dir }, device: { viewport: { width: 390, height: 844 } } });
  await provider.boot();
  await provider.install();
  await provider.launch({ port: 7357, sessionId: 'sess-1' });
});
afterAll(async () => provider.shutdown());

describe('WebProvider (real Chromium)', () => {
  it('injects the connection parameters before page scripts run', async () => {
    expect(await evaluate('window.__QUIESCO__')).toEqual({ port: 7357, session: 'sess-1' });
  });

  it('clicks, double-clicks and long-presses with the mouse', async () => {
    await provider.injectInput({ kind: 'tap', x: 60, y: 30 });
    await provider.injectInput({ kind: 'tap', x: 60, y: 30, count: 2 });
    await provider.injectInput({ kind: 'tap', x: 60, y: 30, holdMs: 120 });
    expect(await evaluate<string[]>('log.filter((e) => e.startsWith("click"))')).toEqual(['click:1', 'click:1', 'click:2', 'click:1']);
  });

  it('types with the keyboard, optionally replacing the content', async () => {
    await provider.injectInput({ kind: 'type', x: 100, y: 95, text: '买牛奶', clearFirst: true });
    expect(await evaluate('document.getElementById("i").value')).toBe('买牛奶');
    await provider.injectInput({ kind: 'type', x: 100, y: 95, text: '!', clearFirst: false });
    expect(await evaluate('document.getElementById("i").value')).toBe('买牛奶!');
  });

  it('chooses an option of a <select> and fills a date input at a point (Phase 6.3)', async () => {
    await provider.injectInput({ kind: 'select', x: 60, y: 315, value: 'b' });
    await provider.injectInput({ kind: 'fill', x: 60, y: 365, value: '2027-03-08' });
    expect(await evaluate<string[]>('log.filter((e) => !e.startsWith("click") && e !== "down" && e !== "up")')).toEqual(['select:b', 'date:2027-03-08']);
    await expect(provider.injectInput({ kind: 'fill', x: 380, y: 830, value: 'x' })).rejects.toThrow();
  });

  it('scrolls with the wheel', async () => {
    await provider.injectInput({ kind: 'wheel', x: 150, y: 200, dx: 0, dy: 300 });
    await expect.poll(() => evaluate<number>('document.getElementById("s").scrollTop')).toBeGreaterThan(0);
  });

  it('takes screenshots and navigates', async () => {
    const png = await provider.screenshot();
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    await provider.injectInput({ kind: 'navigate', url: '/somewhere' });
    expect(await evaluate('location.pathname')).toBe('/somewhere');
    expect(await evaluate('window.__QUIESCO__')).toEqual({ port: 7357, session: 'sess-1' }); // re-injected on reload
    await provider.injectInput({ kind: 'back' });
    expect(await evaluate('location.pathname')).toBe('/');
  });

  it('taps with the touchscreen on touch viewports', async () => {
    const touch = new WebProvider({ app: { distDir: dir }, device: { viewport: { width: 390, height: 844, hasTouch: true, isMobile: true } } });
    await touch.boot();
    await touch.install();
    await touch.launch({ port: 1, sessionId: 's' });
    await touch.injectInput({ kind: 'tap', x: 60, y: 30 });
    const page = (touch as unknown as { page: { evaluate(f: string): Promise<string[]> } }).page;
    expect(await page.evaluate('log')).toContain('touch');
    await touch.shutdown();
  });

  it('plays multi-finger frames as touch events on touch viewports only (Phase 6.4)', async () => {
    // Two fingers: down together, finger 0 moves, finger 1 lifts first, then finger 0.
    const frames = [0, 1, 50, 450, 1, 150, 450, 16, 1, 60, 450, 1, 150, 450, 32, 1, 60, 450, 0, 0, 0, 48, 0, 0, 0, 0, 0, 0];
    await expect(provider.injectInput({ kind: 'touches', fingers: 2, frames })).rejects.toThrow(/touch viewport/);
    const touch = new WebProvider({ app: { distDir: dir }, device: { viewport: { width: 390, height: 844, hasTouch: true, isMobile: true } } });
    await touch.boot();
    await touch.install();
    await touch.launch({ port: 1, sessionId: 's' });
    await touch.injectInput({ kind: 'touches', fingers: 2, frames });
    const page = (touch as unknown as { page: { evaluate(f: string): Promise<string[]> } }).page;
    // CDP reports each changed point as its own DOM event, as a touch screen does.
    expect(await page.evaluate('touchLog')).toEqual(['touchstart:1', 'touchstart:2', 'touchmove:2', 'touchend:1', 'touchend:0']);
    await touch.shutdown();
  });

  it('requires distDir or url', () => {
    expect(() => new WebProvider({ app: {} })).toThrow(/distDir.*url/);
  });
});
