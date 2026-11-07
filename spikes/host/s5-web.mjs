// Phase 0 / S5 spike: open the web build with connection params (mode: initScript | query).
// Needs the `playwright` package (installed outside the repo for the spike). usage: node s5-web.mjs <mode> <port> <session>
import { chromium } from 'playwright';
const [mode, port, session] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', (m) => m.text().includes('[S5]') && console.log(`[browser] ${m.text()}`));
let url = 'http://localhost:8081/';
if (mode === 'initScript') await page.addInitScript(([p, s]) => { window.__QUIESCO__ = { port: p, session: s }; }, [port, session]);
else url += `?quiescoPort=${port}&quiescoSession=${session}`;
await page.goto(url);
await page.waitForTimeout(8000);
await browser.close();
