// Phase 6.5 spike ③: can a Playwright-driven Chromium page really go to the background?
// Records the events the page sees for each candidate method. Usage: node web-visibility.mjs [headed]
import { chromium } from 'playwright';

const headless = process.argv[2] !== 'headed';
const ignore = process.env.KEEP_DEFAULTS ? [] : ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const browser = await chromium.launch({ headless, ignoreDefaultArgs: ignore });
const html = `<script>
  window.__ev = [];
  const log = (t) => window.__ev.push(t + ':' + document.visibilityState + (document.hasFocus() ? '/focus' : '/nofocus'));
  for (const t of ['visibilitychange','pagehide','pageshow','freeze','resume','blur','focus']) (t==='visibilitychange'||t==='freeze'||t==='resume'?document:window).addEventListener(t, () => log(t));
  let ticks = 0; setInterval(() => ticks++, 100); window.__ticks = () => ticks;
</script>`;

async function fresh() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.setContent(html);
  return { context, page };
}
const state = (p) => p.evaluate(() => ({ vis: document.visibilityState, hidden: document.hidden, ev: window.__ev.splice(0) }));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`chromium ${browser.version()} headless=${headless}`);

// A: another page in the same context in front
{
  const { context, page } = await fresh();
  console.log('A0 initial', await state(page));
  const other = await context.newPage();
  await other.bringToFront();
  await pause(300);
  console.log('A1 other page in front', await state(page));
  await page.bringToFront();
  await pause(300);
  console.log('A2 back in front', await state(page));
  await context.close();
}

// B: CDP Page.setWebLifecycleState frozen / active
{
  const { context, page } = await fresh();
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    const t0 = await page.evaluate(() => window.__ticks()).catch((e) => 'eval failed: ' + e.message);
    console.log('B1 frozen (eval while frozen)', t0);
  } catch (e) { console.log('B1 frozen failed', e.message); }
  await pause(500);
  try { await cdp.send('Page.setWebLifecycleState', { state: 'active' }); } catch (e) { console.log('B2 active failed', e.message); }
  console.log('B2 active', await state(page));
  await context.close();
}

// C: CDP Emulation.setFocusEmulationEnabled + setActiveAndFocused(false)
{
  const { context, page } = await fresh();
  const cdp = await context.newCDPSession(page);
  for (const [m, p] of [['Emulation.setFocusEmulationEnabled', { enabled: true }], ['Emulation.setActiveAndFocused', { active: false }]]) {
    try { await cdp.send(m, p); } catch (e) { console.log('C', m, 'failed', e.message); }
  }
  await pause(300);
  console.log('C1 inactive', await state(page));
  try { await cdp.send('Emulation.setActiveAndFocused', { active: true }); } catch (e) { console.log('C2 failed', e.message); }
  await pause(300);
  console.log('C2 active', await state(page));
  await context.close();
}

// D: Target.* — minimise the window (headed) via Browser.setWindowBounds
{
  const { context, page } = await fresh();
  const cdp = await context.newCDPSession(page);
  try {
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    await pause(500);
    console.log('D1 minimized', await state(page));
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await pause(500);
    console.log('D2 normal', await state(page));
  } catch (e) { console.log('D failed', e.message); }
  await context.close();
}
await browser.close();
