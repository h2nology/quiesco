/**
 * `app.webview(target?)` (Phase 6.8): elements of a WebView's page — react-native-webview on iOS / Android
 * (scripts evaluated natively through @quiesco/native), an `<iframe>` on the web (Playwright frames).
 * The page logic is the same everywhere (webview-page.ts); taps are real touches at the element's
 * position on screen, typing is insertText into the focused element (findings 6.8).
 *
 * Every call first waits for the app to be idle and the page to settle (loaded, no fetch / XHR running),
 * and retries until its timeout like the app's own actions and assertions.
 */
import type { JsonValue, Matcher, Point, Rect } from '@quiesco/protocol';

import { QuiescoError } from './errors.js';
import { findNonJson } from './json.js';
import type { TextQuery } from './matcher.js';
import { toTextMatch } from './matcher.js';
import type { CallOptions } from './options.js';
import type { FindResult, PageElement, PageOp, PageState, WebLocator } from './webview-page.js';
import { pageScript, parsePageResult } from './webview-page.js';

/** A WebView locator as written in tests: `{ text }` also takes a RegExp. */
export type WebElementQuery = ({ css: string } | { xpath: string } | { id: string } | { text: TextQuery }) & { index?: number };

/** What the WebView API needs from the driver. */
export interface WebViewHost {
  /** Evaluate `script` in the page of the WebView matching `matcher` (agent sync first); its rect in the window. */
  evalInWebView(matcher: Matcher | undefined, script: string, opts: CallOptions): Promise<{ rect: Rect; value: string; loading: boolean }>;
  /** A real tap at a window point (waits for idle afterwards). */
  tapAt(point: Point, opts: CallOptions): Promise<void>;
  /** The screen cut to `rect` (window coordinates; Phase 6.9). */
  screenshotRect(rect: Rect): Promise<Buffer>;
  readonly defaultTimeoutMs: number;
}

const POLL_MS = 100;
let runKeys = 0;

export class WebView {
  constructor(
    /** @internal */ readonly host: WebViewHost,
    private readonly matcher: Matcher | undefined,
  ) {}

  /** An element of the page: `{ css }`, `{ xpath }`, `{ id }` or `{ text }` (exact after collapsing whitespace, or a RegExp). */
  element(query: WebElementQuery): WebElement {
    return new WebElement(this, toLocator(query));
  }

  /**
   * Run a function body in the page and return its value (JSON); `args` are passed as `arguments`.
   * A returned promise is awaited. `return document.title`
   */
  async runScript<T extends JsonValue = JsonValue>(body: string, args: JsonValue[] = [], opts: CallOptions = {}): Promise<T> {
    const bad = findNonJson(args, '$args');
    if (bad !== null) throw new QuiescoError('NOT_SERIALIZABLE', `runScript argument at ${bad.path} is not JSON (${bad.reason})`, { where: 'args', path: bad.path });
    const deadline = this.deadline(opts);
    await this.settle(deadline, opts);
    const key = `k${Date.now()}_${runKeys++}`;
    const first = await this.page<{ async?: boolean; value?: T }>({ op: 'run', body, args, key }, opts);
    if (first.async !== true) return first.value as T;
    for (;;) {
      const r = await this.page<{ done: boolean; value?: T }>({ op: 'settled', key }, opts);
      if (r.done) return r.value as T;
      if (Date.now() >= deadline) throw new QuiescoError('AGENT_TIMEOUT', `runScript: the promise did not settle within ${this.timeout(opts)}ms`, {});
      await sleep(POLL_MS);
    }
  }

  /** The page's URL (`location.href`). */
  async url(opts: CallOptions = {}): Promise<string> {
    return (await this.state(opts)).url;
  }

  async title(opts: CallOptions = {}): Promise<string> {
    return (await this.state(opts)).title;
  }

  private async state(opts: CallOptions): Promise<PageState> {
    await this.settle(this.deadline(opts), opts);
    return this.page<PageState>({ op: 'state' }, opts);
  }

  // ---- internals (used by WebElement) ----

  timeout(opts: CallOptions): number {
    return opts.timeoutMs ?? this.host.defaultTimeoutMs;
  }

  deadline(opts: CallOptions): number {
    return Date.now() + this.timeout(opts);
  }

  /** Evaluate a page op (no waiting). */
  async page<T>(op: PageOp, opts: CallOptions): Promise<T> {
    return (await this.pageWithRect<T>(op, opts)).value;
  }

  async pageWithRect<T>(op: PageOp, opts: CallOptions): Promise<{ value: T; rect: Rect; loading: boolean }> {
    const r = await this.host.evalInWebView(this.matcher, pageScript(op), opts);
    const parsed = parsePageResult<T>(r.value);
    if (!parsed.ok) {
      if (op.op === 'run' || op.op === 'settled') throw new QuiescoError('APP_ERROR', `The WebView page threw: ${parsed.error}`, { message: parsed.error, kind: 'webview' });
      throw new QuiescoError('AGENT_ERROR', `WebView ${op.op}: ${parsed.error}`, { op: op.op });
    }
    return { value: parsed.value, rect: r.rect, loading: r.loading };
  }

  /**
   * Wait until the page is loaded and has no fetch / XHR running (the app is idle too: each evaluation
   * syncs first). Out of time, the call goes on: its own retries decide (a page polling forever must
   * not block every check).
   */
  async settle(deadline: number, opts: CallOptions): Promise<void> {
    if (opts.sync === false) return;
    for (;;) {
      const s = await this.pageWithRect<PageState>({ op: 'state' }, opts);
      if (!s.loading && s.value.readyState === 'complete' && s.value.pending === 0) return;
      if (Date.now() >= deadline) return;
      await sleep(POLL_MS);
    }
  }
}

export class WebElement {
  constructor(
    private readonly view: WebView,
    private readonly locator: WebLocator,
  ) {}

  /** A real tap on the element (scrolled into view first), then waits for the app and page to settle. */
  async tap(opts: CallOptions = {}): Promise<PageElement> {
    const deadline = this.view.deadline(opts);
    const { element, point } = await this.reveal(deadline, opts);
    await this.view.host.tapAt(point, opts);
    await this.view.settle(this.view.deadline(opts), opts);
    return element;
  }

  /** Tap the field (focus, as a user would), then type `text` at the caret. */
  async type(text: string, opts: CallOptions = {}): Promise<PageElement> {
    return this.input(text, false, opts);
  }

  /** Tap the field, then replace its whole value with `text`. */
  async replaceText(text: string, opts: CallOptions = {}): Promise<PageElement> {
    return this.input(text, true, opts);
  }

  /**
   * PNG of the element, scrolled into view first (Phase 6.9): the part inside the WebView's visible area.
   * `name`: saved and attached through `app.device.screenshot`'s artifacts as well.
   */
  async screenshot(opts: CallOptions = {}): Promise<Buffer> {
    const deadline = this.view.deadline(opts);
    await this.reveal(deadline, opts);
    const { value: r, rect } = await this.view.pageWithRect<FindResult>({ op: 'find', locator: this.locator }, opts);
    const el = r.elements[0];
    if (r.count !== 1 || el === undefined) throw this.notSingle(r, 'screenshot');
    const f = r.innerWidth > 0 ? rect.width / r.innerWidth : 1;
    // Clipped to the WebView: the page may be taller than it.
    const x0 = Math.max(rect.x, rect.x + el.rect.x * f);
    const y0 = Math.max(rect.y, rect.y + el.rect.y * f);
    const x1 = Math.min(rect.x + rect.width, rect.x + (el.rect.x + el.rect.width) * f);
    const y1 = Math.min(rect.y + rect.height, rect.y + (el.rect.y + el.rect.height) * f);
    if (x1 <= x0 || y1 <= y0) throw new QuiescoError('ELEMENT_NOT_FOUND', `${describeLocator(this.locator)} (WebView) is not inside the WebView's visible area`, { locator: this.locator as unknown as JsonValue });
    return this.view.host.screenshotRect({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }

  async scrollIntoView(opts: CallOptions = {}): Promise<PageElement> {
    return (await this.reveal(this.view.deadline(opts), opts)).element;
  }

  async expectExists(opts: CallOptions = {}): Promise<PageElement[]> {
    return this.expect('exists', opts, (f) => (f.count > 0 ? null : 'no element matches'));
  }

  async expectNotExists(opts: CallOptions = {}): Promise<void> {
    await this.expect('not exists', opts, (f) => (f.count === 0 ? null : `${f.count} element(s) match`));
  }

  /** A match is visible in the page's viewport (not scrolled away, not hidden by CSS). */
  async expectVisible(opts: CallOptions = {}): Promise<PageElement[]> {
    return this.expect('visible', opts, (f) => (f.elements.some((e) => e.visible) ? null : f.count === 0 ? 'no element matches' : 'it exists but is not visible'));
  }

  async expectNotVisible(opts: CallOptions = {}): Promise<void> {
    await this.expect('not visible', opts, (f) => (f.elements.some((e) => e.visible) ? 'it is visible' : null));
  }

  /** The element's text (input fields: their value) equals `expected` (whitespace collapsed) or matches it. */
  async expectText(expected: TextQuery, opts: CallOptions = {}): Promise<PageElement> {
    const m = toTextMatch(expected);
    const ok = (t: string): boolean => (typeof m === 'string' ? t === m.replace(/\s+/g, ' ').trim() : new RegExp(m.regex.source, m.regex.flags).test(t));
    const [el] = await this.expect(`text ${typeof expected === 'string' ? JSON.stringify(expected) : String(expected)}`, opts, (f) => {
      if (f.count === 0) return 'no element matches';
      if (f.count > 1) return `${f.count} elements match; add index or a more specific locator`;
      const e = f.elements[0] as PageElement;
      const actual = e.value ?? e.text;
      return ok(actual) ? null : `its text is ${JSON.stringify(actual)}`;
    });
    return el as PageElement;
  }

  // ---- internals ----

  private async input(text: string, replace: boolean, opts: CallOptions): Promise<PageElement> {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    const deadline = this.view.deadline(opts);
    const { point } = await this.reveal(deadline, opts);
    await this.view.host.tapAt(point, opts);
    const r = await this.view.page<FindResult>({ op: 'insert', locator: this.locator, text, replace }, opts);
    if (r.count !== 1) throw this.notSingle(r, 'type');
    await this.view.settle(this.view.deadline(opts), opts);
    return r.elements[0] as PageElement;
  }

  /**
   * Wait for the single match, scroll it into view, and compute its center in window coordinates. The
   * point must be the same in two reads in a row (Phase 6.12): right after scrolling or while the page
   * still lays out, a tap at the first point can miss the element (seen under load on iOS).
   */
  private async reveal(deadline: number, opts: CallOptions): Promise<{ element: PageElement; point: Point }> {
    let prev: Point | null = null;
    for (;;) {
      await this.view.settle(deadline, opts);
      const { value: r, rect } = await this.view.pageWithRect<FindResult>({ op: 'reveal', locator: this.locator }, opts);
      if (r.count > 1) throw this.notSingle(r, 'tap');
      const el = r.elements[0];
      if (el !== undefined && el.visible && !el.disabled) {
        // Page CSS pixels to window units: the page is laid out across the WebView's width.
        const f = r.innerWidth > 0 ? rect.width / r.innerWidth : 1;
        const point = { x: rect.x + (el.rect.x + el.rect.width / 2) * f, y: rect.y + (el.rect.y + el.rect.height / 2) * f };
        const stable = prev !== null && Math.abs(prev.x - point.x) < 0.5 && Math.abs(prev.y - point.y) < 0.5;
        // Out of time, the last point is the best there is.
        if (stable || Date.now() >= deadline) return { element: el, point };
        prev = point;
        await sleep(POLL_MS);
        continue;
      }
      prev = null;
      if (Date.now() >= deadline) {
        const why = el === undefined ? 'No element of the page matches' : el.disabled ? 'The element is disabled:' : 'The element is not visible:';
        throw new QuiescoError('ELEMENT_NOT_FOUND', `${why} ${describeLocator(this.locator)} (WebView)`, { locator: this.locator as unknown as JsonValue });
      }
      await sleep(POLL_MS);
    }
  }

  private async expect(what: string, opts: CallOptions, check: (f: FindResult) => string | null): Promise<PageElement[]> {
    const deadline = this.view.deadline(opts);
    for (;;) {
      await this.view.settle(deadline, opts);
      const f = await this.view.page<FindResult>({ op: 'find', locator: this.locator }, opts);
      const problem = check(f);
      if (problem === null) return f.elements;
      if (Date.now() >= deadline) {
        throw new QuiescoError('ASSERTION_FAILED', `Expected ${describeLocator(this.locator)} (WebView) to be ${what} within ${this.view.timeout(opts)}ms, but ${problem}`, {
          expected: what,
          actual: problem,
          elements: f.elements as unknown as JsonValue,
        });
      }
      await sleep(POLL_MS);
    }
  }

  private notSingle(r: FindResult, action: string): QuiescoError {
    return new QuiescoError('MULTIPLE_MATCHES', `${r.count} elements of the page match ${describeLocator(this.locator)} (WebView ${action}); add index or a more specific locator`, {
      locator: this.locator as unknown as JsonValue,
      matches: r.elements as unknown as JsonValue,
    });
  }
}

function toLocator(q: WebElementQuery): WebLocator {
  if (typeof q !== 'object' || q === null) throw new TypeError('a WebView element query is an object: { css } | { xpath } | { id } | { text }');
  const keys = (['css', 'xpath', 'id', 'text'] as const).filter((k) => k in q && (q as Record<string, unknown>)[k] !== undefined);
  if (keys.length !== 1) throw new RangeError(`a WebView element query needs exactly one of css, xpath, id, text (got ${keys.join(', ') || 'none'})`);
  const index = q.index;
  if (index !== undefined && !(Number.isInteger(index) && index >= 0)) throw new RangeError(`index must be a non-negative integer, got ${index}`);
  const base: WebLocator = 'text' in q ? { text: toTextMatch(q.text) } : 'css' in q ? { css: q.css } : 'xpath' in q ? { xpath: q.xpath } : { id: (q as { id: string }).id };
  return index === undefined ? base : { ...base, index };
}

export function describeLocator(l: WebLocator): string {
  const [k, v] = Object.entries(l).find(([key]) => key !== 'index') as [string, unknown];
  const shown = typeof v === 'object' && v !== null && 'regex' in v ? `/${(v as { regex: { source: string; flags: string } }).regex.source}/${(v as { regex: { flags: string } }).regex.flags}` : JSON.stringify(v);
  return `{ ${k}: ${shown}${l.index !== undefined ? `, index: ${l.index}` : ''} }`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
