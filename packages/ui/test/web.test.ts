/**
 * Smoke test of the built web app (dist/web) in Chromium against the real server and a fake runner:
 * the tree appears, a test runs from its row, results and evidence show, keyboard and theme work.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { TestList } from '@quiesco/protocol';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startUiServer } from '../src/server';
import type { UiServer } from '../src/server';
import { spawnRun } from '../src/spawn';

const staticDir = path.resolve(__dirname, '../dist/web');
const fakeRunner = path.join(__dirname, 'helpers', 'fake-runner.mjs');
const list: TestList = {
  runner: 'cucumber',
  files: ['a.feature'],
  tests: [
    { id: 'a.feature:3', file: 'a.feature', line: 3, name: 'test a.feature:3', path: ['A', 'test a.feature:3'] },
    { id: 'a.feature:9', file: 'a.feature', line: 9, name: 'test a.feature:9', path: ['A', 'test a.feature:9'] },
  ],
  errors: [],
};

let server: UiServer;
let browser: Browser;

beforeAll(async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-ui-web-'));
  fs.writeFileSync(path.join(project, 'a.feature'), 'Feature: A\n\n  Scenario: one\n    Given x\n');
  fs.mkdirSync(path.join(project, 'artifacts', 'x'), { recursive: true });
  // A 1×1 PNG as the "screenshot".
  fs.writeFileSync(path.join(project, 'artifacts', 'x', 'failure.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  server = await startUiServer({
    cwd: project,
    runner: 'cucumber',
    platform: 'web',
    artifactsDir: path.join(project, 'artifacts'),
    staticDir,
    listTests: async () => list,
    // The fake runner reports evidence at /artifacts/x/failure.png: point it into this project.
    startRun: (args, env, onOutput) => spawnRun(process.execPath, [fakeRunner, ...args], { cwd: project, env: { ...process.env, ...env, FAKE_EVIDENCE: path.join(project, 'artifacts', 'x', 'failure.png') }, onOutput }),
  });
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe.runIf(fs.existsSync(path.join(staticDir, 'index.html')))('quiesco ui web app', () => {
  it('lists, runs a test from its row, shows the failure with its evidence; keyboard and theme work', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
    const errors: string[] = [];
    page.setDefaultTimeout(8000);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(server.url);
    // The token leaves the address bar once connected.
    await page.getByText('Connected').waitFor();
    expect(new URL(page.url()).search).toBe('');
    const tree = page.getByRole('tree', { name: 'Test files and tests' });
    await expect.poll(() => tree.getByRole('treeitem').count()).toBe(3); // the file + 2 tests

    // Run the failing test from its row.
    const row = tree.getByRole('treeitem', { name: /test a\.feature:9/ });
    await row.click();
    await row.getByRole('button', { name: 'Run test a.feature:9' }).click();
    await page.getByRole('button', { name: 'Run all' }).waitFor();
    await expect.poll(() => row.getAttribute('aria-label')).toMatch(/Failed/);
    await expect(page.getByRole('alert').filter({ hasText: 'boom' }).count()).resolves.toBe(1);

    // Evidence: the screenshot loads from the server.
    await page.getByRole('group', { name: 'Detail view' }).getByRole('button', { name: /Evidence/ }).click();
    const img = page.getByRole('img', { name: /Screenshot: failure\.png/ });
    await img.waitFor();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);

    // Keyboard: ↑ in the tree moves to the other test; r runs it.
    await row.focus();
    await page.keyboard.press('ArrowUp');
    // (the fake runner finishes in milliseconds: wait for the result, not for "Running…")
    await page.keyboard.press('r');
    await expect.poll(() => tree.getByRole('treeitem', { name: /test a\.feature:3/ }).getAttribute('aria-label')).toMatch(/Passed/);

    // Theme toggle.
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('light');
    expect(errors).toEqual([]);
    await page.close();
  });
});
