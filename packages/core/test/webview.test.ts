import { describe, expect, it } from 'vitest';

import type { Point, Rect } from '@quiesco/protocol';

import { WebView } from '../src/webview';
import type { WebViewHost } from '../src/webview';
import type { PageElement, PageOp } from '../src/webview-page';
import { parsePageResult, pageScript } from '../src/webview-page';

const el = (over: Partial<PageElement> = {}): PageElement => ({ tag: 'button', id: '', text: 'Go', value: null, visible: true, disabled: false, rect: { x: 10, y: 20, width: 100, height: 40 }, ...over });

/** A WebView whose page answers ops through `page` (the op is read back from the generated script). */
function fakeView(page: (op: PageOp) => unknown, opts: { rect?: Rect; loading?: () => boolean; timeoutMs?: number } = {}) {
  const ops: PageOp[] = [];
  const taps: Point[] = [];
  const host: WebViewHost = {
    evalInWebView: async (_m, script) => {
      const op = JSON.parse(/var o = (\{.*\});/.exec(script)?.[1] ?? 'null') as PageOp;
      ops.push(op);
      let value: string;
      try {
        value = JSON.stringify({ v: page(op) });
      } catch (e) {
        value = JSON.stringify({ e: (e as Error).message });
      }
      return { rect: opts.rect ?? { x: 0, y: 100, width: 200, height: 400 }, value, loading: opts.loading?.() ?? false };
    },
    tapAt: async (p) => void taps.push(p),
    defaultTimeoutMs: opts.timeoutMs ?? 1000,
  };
  return { view: new WebView(host, { id: 'help' }), ops, taps };
}

const idle = { readyState: 'complete', pending: 0, url: 'about:blank#faq', title: '帮助', innerWidth: 100 };

describe('WebView (core)', () => {
  it('taps the element at its window position (page px scaled to the WebView width), after the page settles', async () => {
    let pending = 2;
    const { view, ops, taps } = fakeView((op) => {
      if (op.op === 'state') return { ...idle, pending: pending > 0 ? pending-- : 0 };
      return { count: 1, elements: [el()], innerWidth: 100 };
    });
    await view.element({ text: 'Go' }).tap();
    // f = 200 / 100: center (60, 40) in the page → (120, 180) in the window.
    expect(taps).toEqual([{ x: 120, y: 180 }]);
    expect(ops.filter((o) => o.op === 'state').length).toBeGreaterThanOrEqual(3);
    expect(ops.find((o) => o.op === 'reveal')).toEqual({ op: 'reveal', locator: { text: 'Go' } });
  });

  it('types after a tap; replaceText replaces; RegExp text locators and index are passed on', async () => {
    const { view, ops, taps } = fakeView((op) => (op.op === 'state' ? idle : { count: 1, elements: [el({ tag: 'input', value: 'Bob' })], innerWidth: 100 }));
    await view.element({ css: '#name' }).type('Alice');
    await view.element({ text: /^Na/i, index: 1 }).replaceText('Bob');
    expect(taps).toHaveLength(2);
    expect(ops.filter((o) => o.op === 'insert')).toEqual([
      { op: 'insert', locator: { css: '#name' }, text: 'Alice', replace: false },
      { op: 'insert', locator: { text: { regex: { source: '^Na', flags: 'i' } }, index: 1 }, text: 'Bob', replace: true },
    ]);
  });

  it('fails a tap on several matches at once, on a missing element after the timeout', async () => {
    const many = fakeView((op) => (op.op === 'state' ? idle : { count: 3, elements: [el(), el(), el()], innerWidth: 100 }));
    await expect(many.view.element({ css: 'button' }).tap()).rejects.toMatchObject({ errorName: 'MULTIPLE_MATCHES' });
    const none = fakeView((op) => (op.op === 'state' ? idle : { count: 0, elements: [], innerWidth: 100 }), { timeoutMs: 250 });
    await expect(none.view.element({ id: 'x' }).tap()).rejects.toMatchObject({ errorName: 'ELEMENT_NOT_FOUND', message: expect.stringMatching(/No element of the page matches \{ id: "x" \}/) });
    expect(none.taps).toEqual([]);
  });

  it('expectText retries until the text matches, and fails with what it saw', async () => {
    let n = 0;
    const { view } = fakeView((op) => (op.op === 'state' ? idle : { count: 1, elements: [el({ tag: 'p', text: n++ < 2 ? '' : '你好，Alice' })], innerWidth: 100 }));
    await expect(view.element({ id: 'result' }).expectText('你好，Alice')).resolves.toMatchObject({ text: '你好，Alice' });
    const stuck = fakeView((op) => (op.op === 'state' ? idle : { count: 1, elements: [el({ text: 'old' })], innerWidth: 100 }), { timeoutMs: 250 });
    await expect(stuck.view.element({ id: 'result' }).expectText(/new/)).rejects.toMatchObject({ errorName: 'ASSERTION_FAILED', message: expect.stringMatching(/its text is "old"/) });
  });

  it('visibility and existence assertions', async () => {
    const page = { count: 1, elements: [el({ visible: false })], innerWidth: 100 };
    const { view } = fakeView((op) => (op.op === 'state' ? idle : page), { timeoutMs: 250 });
    await view.element({ text: 'Go' }).expectNotVisible();
    await view.element({ text: 'Go' }).expectExists();
    await expect(view.element({ text: 'Go' }).expectVisible()).rejects.toMatchObject({ errorName: 'ASSERTION_FAILED', message: expect.stringMatching(/exists but is not visible/) });
    await expect(view.element({ text: 'Go' }).expectNotExists()).rejects.toMatchObject({ errorName: 'ASSERTION_FAILED' });
  });

  it('runScript returns the value, awaits promises by polling, and reports page exceptions', async () => {
    let polls = 0;
    const { view, ops } = fakeView((op) => {
      if (op.op === 'state') return idle;
      if (op.op === 'run') {
        if (op.body.includes('throw')) throw new Error('nope');
        return op.body.includes('async') ? { async: true } : { value: op.args };
      }
      if (op.op === 'settled') return polls++ < 2 ? { done: false } : { done: true, value: 42 };
      return null;
    });
    await expect(view.runScript('return arguments', [1, 'a'])).resolves.toEqual([1, 'a']);
    await expect(view.runScript('async')).resolves.toBe(42);
    await expect(view.runScript('throw')).rejects.toMatchObject({ errorName: 'APP_ERROR', message: 'The WebView page threw: nope' });
    await expect(view.runScript('x', [new Date() as never])).rejects.toMatchObject({ errorName: 'NOT_SERIALIZABLE' });
    expect(new Set(ops.filter((o) => o.op === 'settled').map((o) => (o as { key: string }).key)).size).toBe(1);
    await expect(view.url()).resolves.toBe('about:blank#faq');
    await expect(view.title()).resolves.toBe('帮助');
  });

  it('waits while the WebView is loading; sync: false skips the wait', async () => {
    let loads = 3;
    const { view, ops } = fakeView((op) => (op.op === 'state' ? idle : { count: 1, elements: [el()], innerWidth: 100 }), { loading: () => loads-- > 0 });
    await view.element({ text: 'Go' }).expectExists();
    expect(ops.filter((o) => o.op === 'state').length).toBe(4);
    const quick = fakeView(() => ({ count: 1, elements: [el()], innerWidth: 100 }), { loading: () => true });
    await quick.view.element({ text: 'Go' }).expectExists({ sync: false });
    expect(quick.ops.map((o) => o.op)).toEqual(['find']);
  });

  it('checks element queries', () => {
    const { view } = fakeView(() => null);
    expect(() => view.element({} as never)).toThrow(/exactly one of css, xpath, id, text/);
    expect(() => view.element({ css: 'a', id: 'b' } as never)).toThrow(/got css, id/);
    expect(() => view.element({ css: 'a', index: -1 })).toThrow(/index/);
  });
});

describe('pageScript / parsePageResult', () => {
  it('embeds the op and the page hook; results and errors round-trip', () => {
    const s = pageScript({ op: 'find', locator: { css: '#a' } });
    expect(s).toContain('"locator":{"css":"#a"}');
    expect(s).toContain('__quiescoPending');
    expect(parsePageResult<number>('{"v":3}')).toEqual({ ok: true, value: 3 });
    expect(parsePageResult('{"e":"bad"}')).toEqual({ ok: false, error: 'bad' });
    expect(parsePageResult('')).toMatchObject({ ok: false, error: expect.stringMatching(/returned nothing/) });
  });

  it('runs in a page (Node vm with a tiny DOM stand-in): state and run ops', async () => {
    const vm = await import('node:vm');
    const win: Record<string, unknown> = { document: { readyState: 'complete', title: 'T' }, location: { href: 'about:blank' }, innerWidth: 320, JSON, Math, Error, Function, String, Object, Array, RegExp };
    win['window'] = win;
    const ctx = vm.createContext(win);
    const run = (op: PageOp) => parsePageResult<Record<string, unknown>>(vm.runInContext(pageScript(op), ctx) as string);
    expect(run({ op: 'state' })).toEqual({ ok: true, value: { readyState: 'complete', pending: 0, url: 'about:blank', title: 'T', innerWidth: 320 } });
    expect(run({ op: 'run', body: 'return arguments[0] + 1', args: [41], key: 'k' })).toEqual({ ok: true, value: { value: 42 } });
    expect(run({ op: 'run', body: 'throw new Error("x")', args: [], key: 'k' })).toEqual({ ok: false, error: 'x' });
  });
});

