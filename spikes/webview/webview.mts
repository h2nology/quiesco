// 6.8 spike: react-native-webview driven through @quiesco/native (webviewInfo / webviewEval /
// webviewAddStartScript, reached here through the temporary `webviewProbe` backdoor):
// round-trip latency, coordinate mapping + a real tap, text input, document-start scripts (for in-page
// request tracking) and navigation. Usage: node spikes/webview/webview.mts ios|android
import type { Platform } from '@quiesco/protocol';

import { log, open, pause, shot } from '../system/common.mts';

const platform = (process.argv[2] ?? 'ios') as Platform;
const s = await open(platform);
type Probe = { tag: number; result: unknown };
const probe = async (fn: string, arg?: string): Promise<unknown> => {
  const r = (await s.driver.backdoor('webviewProbe', fn, ...(arg === undefined ? [] : [arg]))) as unknown as Probe;
  return r.result;
};
/** Evaluate an expression whose value is JSON-stringified in the page. */
const evalJson = async <T,>(expr: string): Promise<{ value: T; ms: number }> => {
  const t0 = Date.now();
  const raw = (await probe('webviewEval', `(function(){ try { return JSON.stringify({ v: (function(){ return ${expr}; })() }); } catch (e) { return JSON.stringify({ e: String(e && e.stack || e) }); } })()`)) as string;
  const r = JSON.parse(raw === '' ? '{}' : raw) as { v?: T; e?: string };
  if (r.e !== undefined) throw new Error(`page threw: ${r.e} (in ${expr.slice(0, 80)})`);
  return { value: r.v as T, ms: Date.now() - t0 };
};

try {
  await s.driver.backdoor('openWebView');
  await s.driver.expectVisible('webview-page');
  // Wait for the page (spike: poll the native load state).
  let info: Record<string, unknown> = {};
  for (let i = 0; i < 40; i++) {
    info = (await probe('webviewInfo')) as Record<string, unknown>;
    if (info['found'] === true && info['loading'] === false) break;
    await pause(100);
  }
  log('info', JSON.stringify(info));

  // 1. Round trip.
  for (const i of [1, 2, 3]) {
    const r = await evalJson<{ title: string; url: string; ready: string; w: number; dpr: number; vv: number }>('({ title: document.title, url: location.href, ready: document.readyState, w: innerWidth, dpr: devicePixelRatio, vv: visualViewport && visualViewport.scale })');
    log(`eval #${i} ${r.ms}ms`, JSON.stringify(r.value));
  }
  const err = await probe('webviewEval', 'nosuchfn()').then((v) => `resolved ${JSON.stringify(v)}`, (e: Error) => `rejected ${e.message.slice(0, 120)}`);
  log('script error →', err);
  const undef = await probe('webviewEval', 'undefined').then((v) => JSON.stringify(v), (e: Error) => `rejected ${e.message}`);
  log('undefined →', undef);

  // 2. Coordinates: page CSS px → window units, then a real tap on #greet after typing into #name.
  const rectOf = async (sel: string) => (await evalJson<{ x: number; y: number; w: number; h: number; iw: number }>(`(function(el){ el.scrollIntoView({ block: 'nearest' }); return el; })(document.querySelector(${JSON.stringify(sel)})) && (function(r){ return { x: r.left, y: r.top, w: r.width, h: r.height, iw: innerWidth }; })(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`)).value;
  const toWindow = (r: { x: number; y: number; w: number; h: number; iw: number }) => {
    const f = (info['width'] as number) / r.iw;
    const top = (info['y'] as number) + ((info['insetTop'] as number | undefined) ?? 0);
    return { x: (info['x'] as number) + (r.x + r.w / 2) * f, y: top + (r.y + r.h / 2) * f, f };
  };
  const name = await rectOf('#name');
  const p1 = toWindow(name);
  log('#name rect', JSON.stringify(name), '→ window', JSON.stringify(p1));
  await s.driver.tapAt({ x: p1.x, y: p1.y });
  const focused = await evalJson<string>("document.activeElement && document.activeElement.id");
  log('focused after real tap:', focused.value);
  await shot(s, `webview-${platform}-focused`);

  // 3. Text: iOS native typeText into the WKWebView's content view; both: execCommand insertText.
  if (platform === 'ios') {
    const t = await probe('typeText', JSON.stringify(['小明', false])).then((v) => JSON.stringify(v), (e: Error) => `rejected ${e.message}`);
    log('native typeText →', t, 'value now', (await evalJson<string>("document.getElementById('name').value")).value);
  }
  await evalJson<boolean>("(function(){ var el = document.getElementById('name'); el.focus(); el.select(); window.__inputs = 0; el.addEventListener('input', function(){ window.__inputs++; }); return document.execCommand('insertText', false, 'Alice'); })()");
  log('execCommand → value', (await evalJson<string>("document.getElementById('name').value")).value, 'input events', (await evalJson<number>('window.__inputs')).value);

  const greet = toWindow(await rectOf('#greet'));
  await s.driver.tapAt({ x: greet.x, y: greet.y });
  log('result after real tap on #greet:', (await evalJson<string>("document.getElementById('result').textContent")).value);
  await shot(s, `webview-${platform}-greeted`);

  // 4. An element below the fold: scrollIntoView, then the rect is in view.
  await evalJson<null>("(document.getElementById('bottom').scrollIntoView({ block: 'center' }), null)");
  const bottom = await rectOf('#bottom');
  log('#bottom after scrollIntoView', JSON.stringify(bottom), 'webview height (page px)', (info['height'] as number) / ((info['width'] as number) / bottom.iw));

  // 5. Document-start script: applies to later loads (a reload of an html source gives about:blank, which
  // shows whether it ran); the current page gets the same hook through eval.
  const HOOK = "if (!window.__qHook) { window.__qHook = Date.now(); window.__qPending = 0; (function(f){ window.fetch = function(){ window.__qPending++; return f.apply(this, arguments).finally(function(){ window.__qPending--; }); }; })(window.fetch); }";
  log('addStartScript →', await probe('webviewAddStartScript', HOOK));
  await evalJson<null>(`(function(){ ${HOOK} return null; })()`);
  const slow = toWindow(await rectOf('#slow'));
  await s.driver.tapAt({ x: slow.x, y: slow.y });
  const t0 = Date.now();
  const seen: string[] = [];
  for (let i = 0; i < 30; i++) {
    const st = await evalJson<{ p: number; r: string }>("({ p: window.__qPending, r: document.getElementById('slow-result').textContent })");
    seen.push(`${Date.now() - t0}:${st.value.p}/${st.value.r || '-'}`);
    if (st.value.r !== '') break;
    await pause(60);
  }
  log('pending fetches over time', seen.join(' '));

  // 6. Navigation inside the page: hash link → title via the info call.
  const faq = toWindow(await rectOf('#faq'));
  await s.driver.tapAt({ x: faq.x, y: faq.y });
  await pause(300);
  info = (await probe('webviewInfo')) as Record<string, unknown>;
  log('after link tap: url', info['url'], 'title', info['title']);
  await probe('webviewEval', 'location.reload()').catch(() => undefined);
  await pause(800);
  log('start script ran on the reloaded page:', (await evalJson<number | null>('window.__qHook || null')).value !== null, 'url', ((await probe('webviewInfo')) as { url: string }).url);
} finally {
  await s.dispose();
}

