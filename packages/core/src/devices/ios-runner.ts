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
import type { Logger } from '../logger.js';
import type { Exec } from './exec.js';
import type { SystemNode } from './provider.js';

/** What the runner reports (Runner/SystemUIServer.swift). Frames are [x, y, width, height] in points. */
export interface RunnerScreen {
  alerts: { label: string; id: string; frame: number[]; texts: { label: string; frame: number[] }[]; buttons: { label: string; id: string; frame: number[] }[] }[];
  others: { label: string; id: string; frame: number[] }[];
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

/** The button that dismisses a leftover alert with the least effect: cancel, deny, else the first one. */
export function dismissButton(alert: RunnerScreen['alerts'][number]): { frame: number[] } | undefined {
  const nodes = screenNodes({ alerts: [alert], others: [] });
  const pick = nodes.find((n) => /cancel/i.test(n.id)) ?? nodes.find((n) => n.id === PERMISSION_DENY);
  if (pick !== undefined) return { frame: [pick.bounds.x1, pick.bounds.y1, pick.bounds.x2 - pick.bounds.x1, pick.bounds.y2 - pick.bounds.y1] };
  return alert.buttons[0];
}

/** Where the runner sources are: <package>/ios-runner (from dist/devices or src/devices). */
export const RUNNER_SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ios-runner');
const RUNNER_FILES = ['QuiescoSystemUI.xcodeproj/project.pbxproj', 'Host/main.swift', 'Runner/SystemUIServer.swift'];
const START_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;

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

  constructor(private readonly options: IosRunnerOptions) {}

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  /** Build (once per Xcode version and runner source) and start the runner, then wait until it answers. */
  async start(): Promise<void> {
    if (this.running) return;
    const xctestrun = await this.build();
    this.port = await freePort();
    this.output = '';
    const started = Date.now();
    this.options.logger.info('starting the iOS system UI runner (XCUITest)');
    const proc = spawn('xcodebuild', ['test-without-building', '-xctestrun', xctestrun, '-destination', `id=${this.options.udid}`, '-only-testing:Runner/SystemUIServer/testServe'], {
      env: { ...process.env, TEST_RUNNER_QUIESCO_PORT: String(this.port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    await this.start();
    return this.request<RunnerScreen>('GET', '/screen');
  }

  async tap(x: number, y: number): Promise<void> {
    await this.start();
    await this.request('POST', `/tap?x=${x.toFixed(1)}&y=${y.toFixed(1)}`);
  }

  async openNotificationCenter(): Promise<void> {
    await this.start();
    await this.request('POST', '/notificationCenter');
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    if (proc === null) return;
    await this.request('POST', '/quit', 2000).catch(() => undefined);
    if (proc.exitCode === null) proc.kill();
  }

  private async build(): Promise<string> {
    const { exec, logger } = this.options;
    const xcode = (await exec('xcodebuild', ['-version'])).stdout.toString();
    const dir = path.join(this.options.cacheDir ?? path.join(os.homedir(), 'Library/Caches/quiesco/ios-runner'), await runnerCacheKey(xcode));
    const products = path.join(dir, 'Build/Products');
    const existing = await findXctestrun(products);
    if (existing !== null) return existing;
    logger.info(`building the iOS system UI runner (once per Xcode version) into ${dir}`);
    await exec(
      'xcodebuild',
      ['build-for-testing', '-project', path.join(RUNNER_SOURCE, 'QuiescoSystemUI.xcodeproj'), '-scheme', 'Runner', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', dir, '-quiet'],
      { timeoutMs: 600_000 },
    ).catch((e: unknown) => {
      throw new QuiescoError('DEVICE_ERROR', `building the iOS system UI runner failed: ${(e as Error).message.slice(-1500)}`);
    });
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
