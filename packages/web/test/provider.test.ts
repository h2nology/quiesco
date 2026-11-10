// Drives a real headless Chromium (requires `npx playwright install chromium`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';

import { pageScript, parsePageResult } from '@quiesco/core';

import { WebProvider, webPathFor } from '../src/provider';

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

  it('relaunch keeps cookies and storage only when asked, passes launch arguments, opens a launch URL path (Phase 6.5)', async () => {
    await evaluate("localStorage.setItem('k', 'v'); document.cookie = 'c=1'");
    await provider.terminate({ keepData: true });
    await expect(provider.launch({ port: 7357, sessionId: 'sess-1', argsObject: { n: 1, o: { a: 'x' } } })).resolves.toBeUndefined();
    expect(await evaluate("[localStorage.getItem('k'), document.cookie]")).toEqual(['v', 'c=1']);
    expect(await evaluate('window.__QUIESCO__')).toEqual({ port: 7357, session: 'sess-1', args: { n: 1, o: { a: 'x' } } });

    await provider.terminate();
    await expect(provider.launch({ port: 7357, sessionId: 'sess-1', url: 'todo://index.html?x=1' })).resolves.toBe('delivered');
    expect(await evaluate("[localStorage.getItem('k'), document.cookie, location.pathname + location.search]")).toEqual([null, '', '/index.html?x=1']);
  });
});

describe('WebProvider device state (Phase 6.6, real Chromium)', () => {
  it('turns the viewport, emulates color scheme, location and permissions, opens again with a locale, and resets', async () => {
    const p = new WebProvider({ app: { distDir: dir }, device: { viewport: { width: 390, height: 844 } } });
    await p.boot();
    await p.install();
    await p.grantPermissions(['location']);
    await p.launch({ port: 7357, sessionId: 's' });
    const page = () => (p as unknown as { page: { evaluate<T>(f: string): Promise<T> } }).page;
    try {
      await p.setOrientation('landscape');
      expect(await page().evaluate('[innerWidth, innerHeight]')).toEqual([844, 390]);
      await p.setAppearance('dark');
      expect(await page().evaluate("matchMedia('(prefers-color-scheme: dark)').matches")).toBe(true);
      await p.setLocation({ latitude: 35.68, longitude: 139.76 });
      expect(await page().evaluate('new Promise((r) => navigator.geolocation.getCurrentPosition((x) => r([x.coords.latitude, x.coords.longitude]), (e) => r(e.message)))')).toEqual([35.68, 139.76]);
      await expect(p.setPermission('location', false)).resolves.toEqual({ relaunch: false });
      await expect(p.resetPermission('location')).resolves.toEqual({ relaunch: false }); // not granted = the browser asks again
      expect(await page().evaluate("navigator.permissions.query({ name: 'geolocation' }).then((s) => s.state)")).toBe('prompt');
      await expect(p.setPermission('contacts', true)).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });

      // A locale needs a new context: the next launch has it, with the other state carried over.
      await expect(p.setLocale('ja-JP')).resolves.toEqual({ relaunch: true });
      await p.terminate({ keepData: true });
      await p.launch({ port: 7357, sessionId: 's' });
      expect(await page().evaluate('[navigator.language, innerWidth, matchMedia("(prefers-color-scheme: dark)").matches]')).toEqual(['ja-JP', 844, true]);

      await expect(p.resetDeviceState()).resolves.toEqual({ relaunch: true });
      expect(await page().evaluate('[innerWidth, matchMedia("(prefers-color-scheme: dark)").matches]')).toEqual([390, false]);
      await p.terminate({ keepData: true });
      await p.launch({ port: 7357, sessionId: 's' });
      expect(await page().evaluate("Promise.all([navigator.language === 'ja-JP', navigator.permissions.query({ name: 'geolocation' }).then((s) => s.state)])")).toEqual([false, 'granted']);
    } finally {
      await p.shutdown();
    }
  });
});

describe('WebProvider network, clipboard and status bar (Phase 6.6, real Chromium)', () => {
  it('offline: page requests fail and navigator.onLine is false, while a WebSocket like Quiesco’s keeps working; reset brings it back', async () => {
    // Stands in for Quiesco's server: an echo WebSocket on localhost.
    const echo = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    echo.on('connection', (ws) => ws.on('message', (m) => ws.send(`echo:${String(m)}`)));
    await new Promise((r) => echo.once('listening', r));
    const port = (echo.address() as AddressInfo).port;
    const p = new WebProvider({ app: { distDir: dir } });
    await p.boot();
    await p.install();
    await p.launch({ port, sessionId: 's' });
    const page = () => (p as unknown as { page: { evaluate<T>(f: string): Promise<T> } }).page;
    const probe = () =>
      page().evaluate<[boolean, string, string]>(`(async () => {
        const fetched = await fetch(location.href, { cache: 'no-store' }).then(() => 'ok', (e) => 'failed: ' + e.message);
        const echoed = await new Promise((r) => { window.sock.onmessage = (e) => r(e.data); window.sock.send('ping'); });
        return [navigator.onLine, fetched, echoed];
      })()`);
    try {
      await page().evaluate(`new Promise((r) => { window.events = []; addEventListener('offline', () => events.push('offline')); addEventListener('online', () => events.push('online')); navigator.connection.addEventListener('change', () => events.push('change')); window.sock = new WebSocket('ws://localhost:${port}'); sock.onopen = r; })`);
      await p.setNetwork(true);
      expect(await probe()).toEqual([false, 'failed: Failed to fetch', 'echo:ping']);
      await p.setNetwork(false);
      expect(await probe()).toEqual([true, 'ok', 'echo:ping']);
      expect(await page().evaluate('events')).toEqual(['change', 'offline', 'change', 'online']);

      // A relaunch while offline loads the page, then goes offline.
      await p.setNetwork(true);
      await p.terminate({ keepData: true });
      await p.launch({ port, sessionId: 's' });
      await page().evaluate(`new Promise((r) => { window.sock = new WebSocket('ws://localhost:${port}'); sock.onopen = r; })`);
      expect(await probe()).toEqual([false, 'failed: Failed to fetch', 'echo:ping']);
      await p.resetDeviceState();
      expect(await probe()).toEqual([true, 'ok', 'echo:ping']);
    } finally {
      await p.shutdown();
      echo.close();
    }
  });

  it('clipboard through navigator.clipboard, also after permissions were changed; the status bar is a no-op', async () => {
    const p = new WebProvider({ app: { distDir: dir } });
    await p.boot();
    await p.install();
    await p.launch({ port: 1, sessionId: 's' });
    const page = () => (p as unknown as { page: { evaluate<T>(f: string): Promise<T> } }).page;
    try {
      await p.setClipboard('こんにちは');
      expect(await page().evaluate('navigator.clipboard.readText()')).toBe('こんにちは');
      await page().evaluate("navigator.clipboard.writeText('from the app')");
      await expect(p.getClipboard()).resolves.toBe('from the app');
      await p.setPermission('location', true); // clears and re-grants the configured permissions
      await p.setClipboard('again');
      await expect(p.getClipboard()).resolves.toBe('again');
      await expect(p.setStatusBar({ time: '9:41' })).resolves.toBeUndefined();
      await expect(p.resetStatusBar()).resolves.toBeUndefined();
    } finally {
      await p.shutdown();
    }
  });
});

describe('WebProvider JS dialogs (real Chromium)', () => {
  const DIALOGS = `<!doctype html><html><body style="margin:0">
<button id="c" style="position:absolute;left:0;top:0;width:100px;height:40px" onclick="window.r = confirm('删除全部?')">c</button>
<button id="a" style="position:absolute;left:0;top:50px;width:100px;height:40px" onclick="alert('已保存'); window.r = 'alerted'">a</button>
<button id="p" style="position:absolute;left:0;top:100px;width:100px;height:40px" onclick="window.r = prompt('名字?', '默认')">p</button>
<script>window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; });</script>
</body></html>`;
  let d: WebProvider;
  const warnings: string[] = [];
  const result = () => (d as unknown as { page: { evaluate<T>(f: string): Promise<T> } }).page.evaluate<unknown>('window.r');
  /** Click (the click stays pending while the dialog is open) and wait for the dialog. */
  const open = async (y: number): Promise<{ message: string; click: Promise<void> }> => {
    const shown = new Promise<string>((resolve) => {
      const stop = d.onBlockingDialog((m) => {
        stop();
        resolve(m);
      });
    });
    const click = d.injectInput({ kind: 'tap', x: 50, y });
    return { message: await shown, click };
  };

  beforeAll(async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-web-dialogs-'));
    fs.writeFileSync(path.join(dir2, 'index.html'), DIALOGS);
    const logger = { debug: () => undefined, info: () => undefined, warn: (m: string) => warnings.push(m), error: () => undefined };
    d = new WebProvider({ app: { distDir: dir2 }, device: { viewport: { width: 390, height: 844 } }, logger });
    await d.boot();
    await d.install();
    await d.launch({ port: 1, sessionId: 's' });
  });
  afterAll(async () => d.shutdown());

  it('holds a confirm until it is answered: Cancel → false, OK → true', async () => {
    expect(await d.systemNodes()).toEqual([]);
    const first = await open(20);
    expect(first.message).toBe('删除全部?');
    expect(d.blockingDialog()).toBe('删除全部?');
    const nodes = await d.systemNodes();
    expect(nodes.map((n) => [n.text, n.id])).toEqual([
      ['删除全部?', 'dialog.message'],
      ['OK', 'dialog.accept'],
      ['Cancel', 'dialog.dismiss'],
    ]);
    await expect(d.screenshot()).rejects.toMatchObject({ errorName: 'DIALOG_OPEN' });
    await expect(d.tapSystemNode(nodes[0]!)).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
    await d.tapSystemNode(nodes[2]!);
    await first.click;
    expect(d.blockingDialog()).toBeNull();
    expect(await result()).toBe(false);

    const second = await open(20);
    await d.tapSystemNode((await d.systemNodes())[1]!);
    await second.click;
    expect(await result()).toBe(true);
    await expect(d.tapSystemNode(nodes[1]!)).rejects.toMatchObject({ errorName: 'DEVICE_ERROR' });
  });

  it('an alert has only OK; a prompt accepted keeps its default value', async () => {
    let { click } = await open(70);
    expect((await d.systemNodes()).map((n) => n.text)).toEqual(['已保存', 'OK']);
    await d.tapSystemNode((await d.systemNodes())[1]!);
    await click;
    expect(await result()).toBe('alerted');

    ({ click } = await open(120));
    await d.tapSystemNode((await d.systemNodes())[1]!);
    await click;
    expect(await result()).toBe('默认');
  });

  it('dismisses a dialog left open at the device reset, with a warning', async () => {
    const { click } = await open(20);
    await d.resetDeviceState();
    await click;
    expect(d.blockingDialog()).toBeNull();
    expect(await result()).toBe(false);
    expect(warnings.some((w) => w.includes('删除全部?'))).toBe(true);
  });

  it('accepts beforeunload: the page can be opened again', async () => {
    // The page asked to confirm leaving (after a user gesture above); a relaunch is not held by it.
    await d.injectInput({ kind: 'navigate', url: '/' });
    expect(d.blockingDialog()).toBeNull();
    await d.launch({ port: 1, sessionId: 's2' });
    expect(await result()).toBeUndefined();
  });
});

describe('WebView pages: the page scripts in a real iframe (Chromium)', () => {
  const INNER = `<!doctype html><html><head><title>帮助</title><meta name="viewport" content="width=device-width"></head><body style="margin:0">
<input id="name" name="name" style="width:200px;height:30px">
<button id="greet">打招呼</button>
<p id="result"><span>你好，</span><b>世界</b></p>
<p style="visibility:hidden">藏起来</p>
<div style="height:2000px"></div>
<p id="bottom">到底了</p>
<script>window.inputs = 0; document.getElementById('name').addEventListener('input', function () { window.inputs++; });
fetch('/never').catch(function () {});</script>
</body></html>`;
  let p: WebProvider;
  let rect: { x: number; y: number; width: number; height: number };
  const run = async <T,>(op: Parameters<typeof pageScript>[0]): Promise<T> => {
    const r = parsePageResult<T>(await p.webviewEval(rect, pageScript(op)));
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  beforeAll(async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-webview-'));
    fs.writeFileSync(path.join(d, 'inner.html'), INNER);
    fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><body style="margin:0"><iframe src="/inner.html" style="position:absolute;left:0;top:50px;width:300px;height:400px;border:0"></iframe></body>');
    p = new WebProvider({ app: { distDir: d }, device: { viewport: { width: 390, height: 844 } } });
    await p.boot();
    await p.install();
    await p.launch({ port: 1, sessionId: 's' });
    rect = { x: 0, y: 50, width: 300, height: 400 };
    const page = (p as unknown as { page: { waitForFunction(f: string): Promise<unknown> } }).page;
    await page.waitForFunction("document.querySelector('iframe').contentDocument && document.querySelector('iframe').contentDocument.readyState === 'complete'");
  });
  afterAll(async () => p.shutdown());

  it('reports the page state, counting the page hook from the first evaluation on', async () => {
    const s = await run<{ readyState: string; pending: number; url: string; title: string; innerWidth: number }>({ op: 'state' });
    expect(s).toMatchObject({ readyState: 'complete', pending: 0, title: '帮助', innerWidth: 300 });
    expect(s.url).toMatch(/\/inner\.html$/);
  });

  it('finds by css, xpath, id and text (innermost, whitespace collapsed, RegExp); hidden and scrolled-away elements are not visible', async () => {
    type F = { count: number; elements: { tag: string; text: string; visible: boolean; rect: { y: number } }[] };
    expect((await run<F>({ op: 'find', locator: { css: 'p' } })).count).toBe(3);
    expect((await run<F>({ op: 'find', locator: { xpath: '//button' } })).elements[0]).toMatchObject({ tag: 'button', text: '打招呼', visible: true });
    expect((await run<F>({ op: 'find', locator: { id: 'result' } })).elements[0]?.text).toBe('你好，世界');
    expect((await run<F>({ op: 'find', locator: { text: '你好，世界' } })).elements.map((e) => e.tag)).toEqual(['p']);
    expect((await run<F>({ op: 'find', locator: { text: { regex: { source: '^打', flags: '' } } } })).count).toBe(1);
    expect((await run<F>({ op: 'find', locator: { text: '藏起来' } })).elements[0]?.visible).toBe(false);
    expect((await run<F>({ op: 'find', locator: { css: 'p', index: 2 } })).elements[0]?.text).toBe('到底了');
    const bottom = await run<F>({ op: 'find', locator: { id: 'bottom' } });
    expect(bottom.elements[0]?.visible).toBe(false);
    const revealed = await run<F>({ op: 'reveal', locator: { id: 'bottom' } });
    expect(revealed.elements[0]).toMatchObject({ visible: true });
    expect(revealed.elements[0]!.rect.y).toBeLessThan(400);
  });

  it('inserts text like typing (input events), and replaces the value', async () => {
    type F = { count: number; elements: { value: string }[] };
    expect((await run<F>({ op: 'insert', locator: { id: 'name' }, text: 'Alice', replace: false })).elements[0]?.value).toBe('Alice');
    expect((await run<F>({ op: 'insert', locator: { id: 'name' }, text: 'Bob', replace: true })).elements[0]?.value).toBe('Bob');
    expect(await run<{ value: number }>({ op: 'run', body: 'return window.inputs', args: [], key: 'a' })).toEqual({ value: 2 });
  });

  it('runs scripts with arguments and promises; page exceptions come back as errors', async () => {
    expect(await run({ op: 'run', body: 'return arguments[0] * 2', args: [21], key: 'b' })).toEqual({ value: 42 });
    expect(await run({ op: 'run', body: 'return new Promise(function (r) { setTimeout(function () { r("later"); }, 50); })', args: [], key: 'c' })).toEqual({ async: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(await run({ op: 'settled', key: 'c' })).toEqual({ done: true, value: 'later' });
    await expect(run({ op: 'run', body: 'nosuch()', args: [], key: 'd' })).rejects.toThrow(/nosuch/);
  });
});

describe('webPathFor', () => {
  it('turns app scheme URLs into paths and keeps paths / http URLs', () => {
    expect(webPathFor('todo://todos/1?tab=a#h')).toBe('/todos/1?tab=a#h');
    expect(webPathFor('todo://playground')).toBe('/playground');
    expect(webPathFor('todo:///settings')).toBe('/settings');
    expect(webPathFor('/a/b')).toBe('/a/b');
    expect(webPathFor('https://example.com/x')).toBe('https://example.com/x');
    expect(webPathFor('relative/path')).toBe('/relative/path');
  });
});
