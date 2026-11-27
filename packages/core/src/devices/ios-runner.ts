/**
 * iOS system UI (Phase 6.7 batch C): alerts, banners and Notification Center belong to SpringBoard, where
 * input injected into the app cannot reach. Quiesco ships a small XCUITest runner (`ios-runner/`, findings
 * 6.7 batch C spike) serving SpringBoard's UI over HTTP; this module builds it once per Xcode version and
 * runner source (cached under ~/Library/Caches/quiesco), starts it on the session's simulator when first
 * needed, and maps its screen to SystemNodes.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { QuiescoError } from '../errors.js';
import { trackChildProcess } from './streams.js';
import type { Logger } from '../logger.js';
import type { Exec } from './exec.js';
import type { SystemNode } from './provider.js';

/** What the runner reports (Runner/SystemUIServer.swift). Frames are [x, y, width, height] in points. */
export interface RunnerScreen {
  alerts: { label: string; id: string; frame: number[]; texts: { label: string; frame: number[] }[]; buttons: { label: string; id: string; frame: number[] }[] }[];
  others: { label: string; id: string; frame: number[] }[];
}

/** An app's UIKit elements (Runner/SystemUIServer.swift `/elements`); `type` is XCUIElement.ElementType. */
export interface RunnerElements {
  state: number;
  elements: { type: number; label: string; id: string; value: string; frame: number[]; enabled?: boolean; selected?: boolean }[];
}

/** The app's navigation bars and their buttons (Runner/SystemUIServer.swift `/navigationBar`). */
export interface RunnerNavigationBar {
  bars: { frame: number[]; buttons: { label: string; id: string; frame: number[]; hittable: boolean }[] }[];
}

/**
 * The back button of the app's top navigation bar, or null (issue #4): UIKit names it `BackButton`; else
 * the first hittable button in the left third of a hittable bar (a custom `headerLeft`). With nested
 * navigators only the visible bars count; the lowest one on screen is the innermost stack.
 */
export function backButton(nav: RunnerNavigationBar): { frame: number[] } | null {
  const bars = [...nav.bars].sort((a, b) => (b.frame[1] ?? 0) - (a.frame[1] ?? 0));
  for (const bar of bars) {
    const named = bar.buttons.find((b) => b.hittable && b.id === 'BackButton');
    if (named !== undefined) return named;
  }
  for (const bar of bars) {
    const left = bar.buttons.find((b) => b.hittable && (b.frame[0] ?? 0) < (bar.frame[0] ?? 0) + (bar.frame[2] ?? 0) / 3);
    if (left !== undefined) return left;
  }
  return null;
}

/** Synthetic ids of a permission alert's buttons (they have no identifiers and follow the device language). */
export const PERMISSION_ALLOW = 'quiesco.permission.allow';
export const PERMISSION_DENY = 'quiesco.permission.deny';
export const PERMISSION_ALLOW_ONCE = 'quiesco.permission.allow-once';

const bounds = (f: readonly number[]): SystemNode['bounds'] => {
  const [x = 0, y = 0, w = 0, h = 0] = f;
  return { x1: x, y1: y, x2: x + w, y2: y + h };
};

/**
 * SystemNodes of a runner screen, alerts first. A system permission alert (no identifiers at all) gets
 * synthetic ids by position, as iOS lays them out: two buttons = deny, allow (notifications, camera…);
 * three = allow once, allow while using the app, deny (location).
 */
export function screenNodes(screen: RunnerScreen): SystemNode[] {
  const out: SystemNode[] = [];
  for (const a of screen.alerts) {
    for (const t of a.texts) out.push({ text: t.label, id: '', bounds: bounds(t.frame) });
    const anonymous = a.id === '' && a.buttons.every((b) => b.id === '');
    const synthetic = !anonymous ? [] : a.buttons.length === 2 ? [PERMISSION_DENY, PERMISSION_ALLOW] : a.buttons.length === 3 ? [PERMISSION_ALLOW_ONCE, PERMISSION_ALLOW, PERMISSION_DENY] : [];
    a.buttons.forEach((b, i) => out.push({ text: b.label, id: b.id !== '' ? b.id : (synthetic[i] ?? ''), bounds: bounds(b.frame) }));
  }
  for (const o of screen.others) out.push({ text: o.label, id: o.id, bounds: bounds(o.frame) });
  return out;
}

/** A system permission alert: no identifiers at all, two or three buttons (see screenNodes). */
export function isPermissionAlert(alert: RunnerScreen['alerts'][number]): boolean {
  return alert.id === '' && alert.buttons.every((b) => b.id === '') && (alert.buttons.length === 2 || alert.buttons.length === 3);
}

/**
 * The app's notifications prompt ("“App” Would Like to Send You Notifications"): a two-button permission
 * alert whose title names notifications. By its words, so in English, Japanese, Chinese or Korean.
 */
export function isNotificationPermissionAlert(alert: RunnerScreen['alerts'][number]): boolean {
  return isPermissionAlert(alert) && alert.buttons.length === 2 && /notification|通知|알림/i.test(alert.label);
}

/** `"<title>" [<button>, <button>]`, for messages. */
export function describeAlert(alert: RunnerScreen['alerts'][number]): string {
  return `${JSON.stringify(alert.label)} [${alert.buttons.map((b) => b.label).join(', ')}]`;
}

/**
 * The button that dismisses a leftover alert with the least effect: cancel, else the first one, with
 * its label. None for a permission alert (issue #86): its "Don't Allow" leaves a denied permission
 * (notifications: until the app is reinstalled), its "Allow" a grant the test did not ask for.
 */
export function dismissButton(alert: RunnerScreen['alerts'][number]): { frame: number[]; label: string } | undefined {
  if (isPermissionAlert(alert)) return undefined;
  const cancel = alert.buttons.find((b) => /cancel/i.test(b.id));
  return cancel ?? alert.buttons[0];
}

/** Where the runner sources are: <package>/ios-runner (from dist/devices or src/devices). */
export const RUNNER_SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ios-runner');
const RUNNER_FILES = ['QuiescoSystemUI.xcodeproj/project.pbxproj', 'Host/main.swift', 'Runner/SystemUIServer.swift'];
const START_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** Where built runners are kept by default. */
export const DEFAULT_RUNNER_CACHE = path.join(os.homedir(), 'Library/Caches/quiesco/ios-runner');

/** A runner use this recent makes the next session start the runner early (config warmUpSystemUi: 'auto'). */
export const SYSTEM_UI_USE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const useMarker = (cacheBase: string, bundleId: string): string => path.join(cacheBase, 'used', bundleId.replace(/[^\w.-]/g, '_'));

/** Note that a session of the app `bundleId` used the system UI runner (the marker's time is the last use). */
export async function recordSystemUiUse(cacheBase: string, bundleId: string, now = new Date()): Promise<void> {
  const file = useMarker(cacheBase, bundleId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '');
  await fs.utimes(file, now, now);
}

/** Whether a session of the app `bundleId` used the system UI runner within `maxAgeMs`. */
export async function usedSystemUiRecently(cacheBase: string, bundleId: string, maxAgeMs = SYSTEM_UI_USE_MAX_AGE_MS, now = Date.now()): Promise<boolean> {
  const stat = await fs.stat(useMarker(cacheBase, bundleId)).catch(() => null);
  return stat !== null && now - stat.mtimeMs <= maxAgeMs;
}

/** Cache key: the Xcode version and the runner's sources (a new Xcode or Quiesco rebuilds it). */
export async function runnerCacheKey(xcodeVersion: string, readFile: (p: string) => Promise<string | Buffer> = (p) => fs.readFile(p)): Promise<string> {
  const h = createHash('sha256').update(xcodeVersion.trim());
  for (const f of RUNNER_FILES) h.update(await readFile(path.join(RUNNER_SOURCE, f)));
  return h.digest('hex').slice(0, 16);
}

export interface IosRunnerOptions {
  udid: string;
  exec: Exec;
  logger: Logger;
  /** Where built runners are kept. Default ~/Library/Caches/quiesco/ios-runner. */
  cacheDir?: string;
}

export class IosSystemRunner {
  private proc: ChildProcess | null = null;
  private port = 0;
  private output = '';
  /** A start in progress: everyone who needs the runner meanwhile waits for it (a warm-up, then a call). */
  private starting: Promise<void> | null = null;

  constructor(private readonly options: IosRunnerOptions) {}

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  /**
   * Build (once per Xcode version and runner source) and start the runner, then wait until it answers.
   * A call made while a start is in progress waits for that start: the process is there before it
   * answers, and a request to it then would be refused and restart it.
   */
  start(): Promise<void> {
    if (this.starting !== null) return this.starting;
    if (this.running) return Promise.resolve();
    this.starting = this.startOnce().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Whether the runner for this Xcode is built already (start() would not build it first). */
  async built(): Promise<boolean> {
    return (await findXctestrun(await this.productsDir())) !== null;
  }

  private async startOnce(): Promise<void> {
    const xctestrun = await this.build();
    this.port = await freePort();
    this.output = '';
    const started = Date.now();
    this.options.logger.info('starting the iOS system UI runner (XCUITest)');
    const proc = spawn('xcodebuild', ['test-without-building', '-xctestrun', xctestrun, '-destination', `id=${this.options.udid}`, '-only-testing:Runner/SystemUIServer/testServe'], {
      env: { ...process.env, TEST_RUNNER_QUIESCO_PORT: String(this.port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackChildProcess(proc);
    const keep = (d: Buffer) => {
      this.output = (this.output + d.toString()).slice(-8000);
    };
    proc.stdout?.on('data', keep);
    proc.stderr?.on('data', keep);
    this.proc = proc;
    for (;;) {
      if (await this.request<RunnerScreen>('GET', '/screen', 2000).then(() => true, () => false)) break;
      if (proc.exitCode !== null || Date.now() - started > START_TIMEOUT_MS) {
        await this.stop();
        throw new QuiescoError('DEVICE_ERROR', `the iOS system UI runner did not start (xcodebuild test-without-building):\n${this.output.slice(-2000)}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    this.options.logger.debug(`iOS system UI runner ready in ${Date.now() - started} ms`);
  }

  async screen(): Promise<RunnerScreen> {
    return this.call(() => this.request<RunnerScreen>('GET', '/screen'), true);
  }

  async tap(x: number, y: number): Promise<void> {
    await this.call(() => this.request('POST', `/tap?x=${x.toFixed(1)}&y=${y.toFixed(1)}`));
  }

  /** The navigation bars of the app `bundleId` (issue #4). */
  async navigationBar(bundleId: string): Promise<RunnerNavigationBar> {
    return this.call(() => this.request<RunnerNavigationBar>('GET', `/navigationBar?bundleId=${encodeURIComponent(bundleId)}`), true);
  }

  /**
   * The UIKit elements of the app or system service `bundleId`, from one snapshot (issues #49–#51), and
   * the app's state (XCUIApplication.State: 1 not running … 4 in front).
   */
  async elements(bundleId: string): Promise<RunnerElements> {
    return this.call(() => this.request('GET', `/elements?bundleId=${encodeURIComponent(bundleId)}`), true);
  }

  /**
   * The state of the app `bundleId` alone (XCUIApplication.State: 1 not running, 2 suspended, 3 in the
   * background, 4 in front), without reading its UI: openNotification confirms its tap with it (issue #68).
   */
  async appState(bundleId: string): Promise<number> {
    return (await this.call(() => this.request<{ state: number }>('GET', `/appState?bundleId=${encodeURIComponent(bundleId)}`), true)).state;
  }

  /** Type into the focused field of `bundleId` through its keyboard (XCUITest typeText, issue #51). */
  async typeText(bundleId: string, text: string): Promise<void> {
    await this.call(() => this.request('POST', `/typeText?bundleId=${encodeURIComponent(bundleId)}&text=${encodeURIComponent(text)}`));
  }

  /**
   * Open `url` in the app `bundleId` as another app would (XCUIApplication.open): the system brings the
   * app to the front with it, without the "Open in …?" confirmation `simctl openurl` gets. The app's
   * state afterwards (XCUIApplication.State).
   */
  async open(bundleId: string, url: string): Promise<number> {
    return (await this.call(() => this.request<{ state: number }>('POST', `/open?bundleId=${encodeURIComponent(bundleId)}&url=${encodeURIComponent(url)}`))).state;
  }

  /** The interactive-pop gesture: a drag from the left edge of the screen (issue #4). */
  async edgeSwipeBack(): Promise<void> {
    await this.call(() => this.request('POST', '/edgeSwipeBack'));
  }

  async openNotificationCenter(): Promise<void> {
    await this.call(() => this.request('POST', '/notificationCenter'));
  }

  /**
   * A request to the running runner. The runner's test can die while xcodebuild lives on (seen in parallel
   * runs, Phase 6.12): nothing listens on its port any more. Or it dies while answering (an XCTest failure
   * ends the test, issue #65): the connection is reset. Then the runner is restarted, and a request that
   * only reads (`readOnly`), or one that never reached it (refused), is sent again once. A tap that may
   * have happened is not repeated: it fails with what the runner printed.
   */
  private async call<T>(request: () => Promise<T>, readOnly = false): Promise<T> {
    await this.start();
    try {
      return await request();
    } catch (e) {
      if (!isRunnerGone(e)) throw e;
      const output = this.output.slice(-1500);
      this.options.logger.warn(`the iOS system UI runner stopped answering (${describeNetworkError(e)}); restarting it. Its last output:\n${output}`);
      await this.stop();
      await this.start();
      if (!readOnly && !isConnectionRefused(e)) {
        throw new QuiescoError('DEVICE_ERROR', `the iOS system UI runner ended while answering (${describeNetworkError(e)}); it was restarted. Its last output:\n${output}`);
      }
      try {
        return await request();
      } catch (again) {
        if (!isRunnerGone(again)) throw again;
        throw new QuiescoError('DEVICE_ERROR', `the iOS system UI runner stopped answering twice (${describeNetworkError(again)}). Its last output:\n${this.output.slice(-1500)}`);
      }
    }
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    if (proc === null) return;
    await this.request('POST', '/quit', 2000).catch(() => undefined);
    if (proc.exitCode === null) proc.kill();
  }

  /** The runner's cache directory for this Xcode and runner source. */
  private async cacheDir(): Promise<string> {
    const xcode = (await this.options.exec('xcodebuild', ['-version'])).stdout.toString();
    return path.join(this.options.cacheDir ?? DEFAULT_RUNNER_CACHE, await runnerCacheKey(xcode));
  }

  private async productsDir(): Promise<string> {
    return path.join(await this.cacheDir(), 'Build/Products');
  }

  private async build(): Promise<string> {
    const { exec, logger } = this.options;
    const dir = await this.cacheDir();
    const products = path.join(dir, 'Build/Products');
    const existing = await findXctestrun(products);
    if (existing !== null) return existing;
    // Parallel workers may all build at once (Phase 6.12): each builds into its own directory and renames
    // it into place when done, so nobody reads a half-built runner; the losers drop their copy.
    const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
    logger.info(`building the iOS system UI runner (once per Xcode version) into ${dir}`);
    try {
      await exec(
        'xcodebuild',
        ['build-for-testing', '-project', path.join(RUNNER_SOURCE, 'QuiescoSystemUI.xcodeproj'), '-scheme', 'Runner', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', tmp, '-quiet'],
        { timeoutMs: 600_000 },
      ).catch((e: unknown) => {
        throw new QuiescoError('DEVICE_ERROR', `building the iOS system UI runner failed: ${(e as Error).message.slice(-1500)}`);
      });
      if ((await findXctestrun(path.join(tmp, 'Build/Products'))) === null) {
        throw new QuiescoError('DEVICE_ERROR', `building the iOS system UI runner produced no .xctestrun in ${tmp}/Build/Products`);
      }
      await fs.rename(tmp, dir).catch(async (e: unknown) => {
        // Another worker finished first (the directory exists and is not empty): use its runner.
        if ((await findXctestrun(products)) === null) throw e;
      });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
    const built = await findXctestrun(products);
    if (built === null) throw new QuiescoError('DEVICE_ERROR', `building the iOS system UI runner produced no .xctestrun in ${products}`);
    return built;
  }

  private async request<T>(method: 'GET' | 'POST', p: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const r = await fetch(`http://127.0.0.1:${this.port}${p}`, { method, signal: AbortSignal.timeout(timeoutMs) });
    const body = (await r.json()) as T & { error?: string };
    if (!r.ok) throw new QuiescoError('DEVICE_ERROR', `iOS system UI runner: ${p}: ${body.error ?? r.status}`);
    return body;
  }
}

/** The error's network code: `TypeError: fetch failed` carries it in `cause` (undici). */
function networkCode(e: unknown): string {
  const cause = (e as { cause?: { code?: string } } | null)?.cause;
  return cause?.code ?? '';
}

function describeNetworkError(e: unknown): string {
  return networkCode(e) || String((e as Error | null)?.message ?? e);
}

/**
 * The runner is not there any more: nobody listens (ECONNREFUSED) or it went away while answering
 * (ECONNRESET, a closed socket; issue #65).
 */
export function isRunnerGone(e: unknown): boolean {
  if (isConnectionRefused(e)) return true;
  const code = networkCode(e);
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET' || code === 'UND_ERR_CLOSED') return true;
  return /ECONNRESET|socket hang up|other side closed/.test(String((e as Error | null)?.message ?? ''));
}

/** fetch() to a port nobody listens on: `TypeError: fetch failed` caused by ECONNREFUSED. */
export function isConnectionRefused(e: unknown): boolean {
  const cause = (e as { cause?: { code?: string } } | null)?.cause;
  return cause?.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(String((e as Error | null)?.message ?? ''));
}

async function findXctestrun(dir: string): Promise<string | null> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const f = files.find((n) => n.endsWith('.xctestrun'));
  return f === undefined ? null : path.join(dir, f);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}
