// Phase 0 / S7 spike: load the web build, collect [S1]/[S2] logs from the in-page spike code and
// compare its getBoundingClientRect() with Playwright's own boundingBox().
// usage: node s7-web.mjs <url>   (needs the `playwright` package)
import { chromium } from 'playwright';

const [url] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => true);
const deadline = Date.now() + 120000;
while (!logs.some((l) => l.includes('[S2] end')) && Date.now() < deadline) await page.waitForTimeout(250);
for (const l of logs) for (const line of l.split('\n')) if (/^\[S(1|2)|pageerror|rror/.test(line)) console.log(line.slice(0, 260));
for (const id of ['pressable-button', 'rngh-button', 'pressable-count', 'native-ping']) {
  const box = await page.locator(`[data-testid="${id}"]`).first().boundingBox();
  console.log(`[playwright] ${id} ${JSON.stringify(box)}`);
}
await browser.close();
