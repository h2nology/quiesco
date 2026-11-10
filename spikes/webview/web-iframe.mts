// 6.8 spike (web): the WebView page renders an <iframe srcdoc> on the web. Is it reachable through
// Playwright's frame API from the provider's page (locate, fill, click, read text, scroll), and how does
// the iframe show up to the agent (host element by testID)?
import path from 'node:path';

import { Session } from '@quiesco/core';
import type { Page } from 'playwright';

const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);
const app = path.resolve(import.meta.dirname, '../../examples/todo-app');
const s = await Session.create({ platform: 'web', config: { apps: { web: { distDir: path.join(app, 'dist') } }, devices: { web: { viewport: { width: 390, height: 844, hasTouch: true, isMobile: true } } }, logLevel: 'warn' } as never });
try {
  await s.driver.backdoor('openWebView');
  await s.driver.expectVisible('webview-page');
  const page = (s.provider as unknown as { page: Page }).page;
  const host = await s.driver.query({ id: 'help' }).catch((e: Error) => `query failed: ${e.message}`);
  log('agent sees the iframe host:', JSON.stringify(host).slice(0, 300));
  log('frames:', page.frames().map((f) => `${f.name() || '-'} ${f.url()}`).join(' | '));
  const handle = await page.$('iframe[data-testid="help"]');
  const frame = await handle?.contentFrame();
  log('contentFrame found:', frame !== null && frame !== undefined);
  if (frame) {
    await frame.waitForLoadState();
    log('title', await frame.title(), 'url', frame.url());
    const t0 = Date.now();
    await frame.locator('#name').fill('Alice');
    await frame.locator('#greet').click();
    log('result', await frame.locator('#result').textContent(), Date.now() - t0, 'ms');
    await frame.locator('#bottom').scrollIntoViewIfNeeded();
    log('bottom box', JSON.stringify(await frame.locator('#bottom').boundingBox()));
    log('xpath', await frame.locator('xpath=//h1').textContent(), 'text', await frame.getByText('常见问题').count());
    log('evaluate', await frame.evaluate(() => document.readyState));
  }
} finally {
  await s.dispose();
}
