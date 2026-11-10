/**
 * The scripts Quiesco evaluates in a WebView's page (Phase 6.8): the same on every platform (native
 * WebViews through @quiesco/native, iframes through Playwright frames). Each is one expression whose value
 * is a JSON string `{ "v": result }` or `{ "e": message }`: WebViews report page exceptions badly (iOS a
 * generic localized message, Android nothing; findings 6.8), so every script catches its own.
 */
import { WEBVIEW_HOOK } from '@quiesco/protocol';
import type { TextMatch } from '@quiesco/protocol';

/** How an element of the page is found. `index` picks one of several matches (document order). */
export type WebLocator = ({ css: string } | { xpath: string } | { id: string } | { text: TextMatch }) & { index?: number };

export interface PageState {
  readyState: string;
  /** fetch / XHR calls of the page still running. */
  pending: number;
  url: string;
  title: string;
  innerWidth: number;
}

export interface PageElement {
  tag: string;
  id: string;
  text: string;
  value: string | null;
  visible: boolean;
  disabled: boolean;
  /** In the page's CSS pixels, relative to its viewport. */
  rect: { x: number; y: number; width: number; height: number };
}

export interface FindResult {
  count: number;
  /** The first matches (at most 10). */
  elements: PageElement[];
  innerWidth: number;
}

export type PageOp =
  | { op: 'state' }
  | { op: 'find'; locator: WebLocator }
  /** Scroll the single match into view, then report it. */
  | { op: 'reveal'; locator: WebLocator }
  /** Type into the single match (it has the focus after a tap): insertText, as a keyboard would. */
  | { op: 'insert'; locator: WebLocator; text: string; replace: boolean }
  /** A function body; a promise result is kept and read with `settled`. */
  | { op: 'run'; body: string; args: unknown[]; key: string }
  | { op: 'settled'; key: string };

/** The page-side implementation, shared by every op. Plain ES5: it runs in whatever WebView the app has. */
const RUNTIME = `
var norm = function (s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); };
var textOk = function (t, m) { return typeof m === 'string' ? t === norm(m) : new RegExp(m.regex.source, m.regex.flags).test(t); };
var ownText = function (el) {
  if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type)) return norm(el.value);
  // textContent, not innerText: innerText leaves out hidden elements, which must still be found (expectNotVisible).
  return norm(el.textContent);
};
var findAll = function (l) {
  var out = [];
  if (l.css !== undefined) out = Array.prototype.slice.call(document.querySelectorAll(l.css));
  else if (l.xpath !== undefined) {
    var r = document.evaluate(l.xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (var i = 0; i < r.snapshotLength; i++) { var n = r.snapshotItem(i); if (n && n.nodeType === 1) out.push(n); }
  } else if (l.id !== undefined) { var e = document.getElementById(l.id); out = e ? [e] : []; }
  else if (l.text !== undefined) {
    var all = document.body ? document.body.getElementsByTagName('*') : [];
    var hits = [];
    for (var k = 0; k < all.length; k++) { var el = all[k]; if (!/^(SCRIPT|STYLE|HEAD|TITLE)$/.test(el.tagName) && textOk(ownText(el), l.text)) hits.push(el); }
    // The innermost matches: an element whose child matches too is a container of the text.
    out = hits.filter(function (el) { return !hits.some(function (o) { return o !== el && el.contains(o); }); });
  }
  if (l.index !== undefined && l.index !== null) out = out[l.index] ? [out[l.index]] : [];
  return out;
};
var visible = function (el) {
  var r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
  for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
    var s = getComputedStyle(e);
    if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') return false;
  }
  return true;
};
var describe = function (el) {
  var r = el.getBoundingClientRect();
  var hasValue = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
  return { tag: el.tagName.toLowerCase(), id: el.id || '', text: ownText(el), value: hasValue ? el.value : null, visible: visible(el), disabled: el.disabled === true,
    rect: { x: r.left, y: r.top, width: r.width, height: r.height } };
};
var found = function (l) { var all = findAll(l); return { count: all.length, elements: all.slice(0, 10).map(describe), innerWidth: innerWidth, all: all }; };
var ops = {
  state: function () { return { readyState: document.readyState, pending: window.__quiescoPending || 0, url: location.href, title: document.title, innerWidth: innerWidth }; },
  find: function (o) { var f = found(o.locator); delete f.all; return f; },
  reveal: function (o) {
    var f = found(o.locator);
    if (f.count === 1) { f.all[0].scrollIntoView({ block: 'center', inline: 'center' }); f.elements = [describe(f.all[0])]; }
    delete f.all; return f;
  },
  insert: function (o) {
    var f = found(o.locator);
    if (f.count !== 1) { delete f.all; return f; }
    var el = f.all[0];
    if (document.activeElement !== el) el.focus();
    if (o.replace) { if (typeof el.select === 'function') el.select(); else document.execCommand('selectAll', false); }
    var before = el.value;
    var ok = document.execCommand('insertText', false, o.text);
    if (!ok || (before !== undefined && el.value === before && o.text !== '')) {
      // No editing command here (e.g. a non-editable target): set the value as frameworks expect.
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var d = Object.getOwnPropertyDescriptor(proto, 'value');
      var v = (o.replace ? '' : (el.value || '')) + o.text;
      if (d && d.set) d.set.call(el, v); else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    f.elements = [describe(el)]; delete f.all; return f;
  },
  run: function (o) {
    var r = (new Function(o.body)).apply(null, o.args);
    if (r && typeof r.then === 'function') {
      var box = (window.__quiescoAsync = window.__quiescoAsync || {});
      box[o.key] = { done: false };
      r.then(function (v) { box[o.key] = { done: true, v: v === undefined ? null : v }; }, function (e) { box[o.key] = { done: true, e: String(e && e.message || e) }; });
      return { async: true };
    }
    return { value: r === undefined ? null : r };
  },
  settled: function (o) {
    var b = (window.__quiescoAsync || {})[o.key];
    if (!b || !b.done) return { done: false };
    delete window.__quiescoAsync[o.key];
    if (b.e !== undefined) throw new Error(b.e);
    return { done: true, value: b.v };
  }
};
`;

/** The script evaluating `op` in the page (an expression with a JSON string value). */
export function pageScript(op: PageOp): string {
  return `(function () {
  try {
    ${WEBVIEW_HOOK}
    ${RUNTIME}
    var o = ${JSON.stringify(op)};
    return JSON.stringify({ v: ops[o.op](o) });
  } catch (e) {
    return JSON.stringify({ e: String(e && e.message || e) });
  }
})()`;
}

/** The value of a pageScript, or the page's exception. */
export function parsePageResult<T>(raw: string): { ok: true; value: T } | { ok: false; error: string } {
  let r: { v?: T; e?: string };
  try {
    r = JSON.parse(raw) as { v?: T; e?: string };
  } catch {
    return { ok: false, error: raw === '' ? 'the WebView returned nothing (is the page loaded?)' : `unexpected result ${raw.slice(0, 200)}` };
  }
  if (typeof r.e === 'string') return { ok: false, error: r.e };
  return { ok: true, value: r.v as T };
}
