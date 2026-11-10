// 6.7 web dialogs spike: what Playwright does with alert / confirm / prompt while a 'dialog' listener holds them.
import { chromium } from 'playwright';
import type { Dialog } from 'playwright';

const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(17, 23)}]`, ...a);
const html = `<button id=b style="width:200px;height:80px" onclick="document.getElementById('r').textContent = String(confirm('删除全部?'))">go</button>
<div id=r>-</div><script>setInterval(() => { window.ticks = (window.ticks || 0) + 1 }, 50)</script>`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
let held: Dialog | null = null;
let opened!: () => void;
const dialogOpened = new Promise<void>((r) => (opened = r));
page.on('dialog', (d) => {
  log('dialog event', d.type(), JSON.stringify(d.message()), JSON.stringify(d.defaultValue()));
  held = d;
  opened();
});
const t0 = Date.now();
const click = page.mouse.click(100, 40).then(() => log('mouse.click resolved after', Date.now() - t0, 'ms'));
await Promise.race([click, dialogOpened]);
log('dialog seen after', Date.now() - t0, 'ms; click pending:', held !== null);
const ev = Promise.race([page.evaluate(() => (window as unknown as { ticks: number }).ticks).then((t) => `evaluate ok ${t}`), new Promise((r) => setTimeout(() => r('evaluate blocked (1s)'), 1000))]);
log(await ev);
await (held as Dialog | null)?.dismiss();
log('dismissed');
await click;
log('result', await page.textContent('#r'));
// beforeunload while navigating
await page.evaluate(() => window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; }));
await page.mouse.click(5, 300); // user activation needed for beforeunload prompts
const nav = page.goto('about:blank').then(() => log('goto resolved'), (e: Error) => log('goto failed', e.message.slice(0, 80)));
await Promise.race([nav, new Promise((r) => setTimeout(r, 1500))]);
log('beforeunload held?', (held as Dialog | null)?.type());
if ((held as Dialog | null)?.type() === 'beforeunload') await (held as Dialog).accept();
await nav;
await browser.close();
