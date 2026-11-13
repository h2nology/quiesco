/**
 * Runner-agnostic session API (requirements.md §6.10 "运行器无关"). A runner adapter maps its lifecycle
 * onto it: createSession (BeforeAll) → beforeScenario (Before) → collectEvidence (After, on failure)
 * → dispose (AfterAll). Nothing here knows about Cucumber.
 */
import { randomUUID } from 'node:crypto';

import type { AgentConfig, Platform, TrackerState, TreeNode } from '@quiesco/protocol';

import type { QuiescoConfig } from './config.js';
import { DEFAULT_CONNECT_TIMEOUT_MS, ignoredAppErrors, serverPort, toAgentConfig } from './config.js';
import { AndroidProvider } from './devices/android.js';
import { IosProvider } from './devices/ios.js';
import { SERIAL_WORKER } from './devices/provider.js';
import type { DeviceProvider, LaunchParams, LaunchUrlHandling, WorkerInfo } from './devices/provider.js';
import { DeviceApi } from './device.js';
import type { AppRunState, DeviceHost } from './device.js';
import { Artifacts } from './artifacts.js';
import type { Attachment, ScenarioArtifacts } from './artifacts.js';
import { Driver } from './driver.js';
import { failureRects, highlight } from './screenshots.js';
import { checkLaunchArgs, encodeLaunchArgs } from './launch-args.js';
import type { LaunchArgs } from './launch-args.js';
import { SyncApi } from './sync-api.js';
import { QuiescoError } from './errors.js';
import type { Logger } from './logger.js';
import { consoleLogger } from './logger.js';
import type { AgentConnection } from './server/ws-server.js';
import { QuiescoServer } from './server/ws-server.js';
import { tagNames } from './tags.js';

/** The session's first launch waits this many times the default connect timeout. */
export const FIRST_LAUNCH_CONNECT_FACTOR = 3;

/** Errors of the per-scenario reset after which the app is started again instead of failing the scenario. */
const RESTART_ON: ReadonlySet<string> = new Set(['CONNECT_TIMEOUT', 'AGENT_DISCONNECTED', 'AGENT_TIMEOUT']);

/**
 * How long a launch waits for the app. The session's first launch comes right after installing the app
 * (every session installs `binaryPath`) and maybe a boot: Android verifies and compiles the new APK on
 * that start, which took over 30 s on a busy machine (Phase 6.12, two emulators). A configured timeout
 * always wins.
 */
export function launchConnectTimeout(config: QuiescoConfig, launch: { first: boolean }): number {
  if (config.connectTimeoutMs !== undefined) return config.connectTimeoutMs;
  return launch.first ? FIRST_LAUNCH_CONNECT_FACTOR * DEFAULT_CONNECT_TIMEOUT_MS : DEFAULT_CONNECT_TIMEOUT_MS;
}

export interface SessionOptions {
  config: QuiescoConfig;
  platform: Platform;
  logger?: Logger;
  /** Override the device provider (tests, custom providers). */
  provider?: DeviceProvider;
  /**
   * The parallel test worker this session belongs to (Phase 6.12): its own device, server port
   * (`server.port + index`) and artifacts directory. Default: the only worker.
   */
  worker?: WorkerInfo;
}

export interface Evidence {
  screenshot?: Buffer;
  tree?: TreeNode | null;
  idle?: TrackerState[];
  /** Why a piece could not be collected. */
  errors: string[];
}

export interface ScenarioInfo {
  tags?: readonly string[];
  /** The scenario's name: its artifacts directory (Phase 6.9). */
  name?: string;
}

/** Packages providing a platform's DeviceProvider, loaded at runtime (core never imports them statically). */
const PROVIDER_PACKAGES: Partial<Record<Platform, { name: string; install: string }>> = {
  web: { name: '@quiesco/web', install: 'npm i -D @quiesco/web playwright && npx playwright install chromium' },
};

type ProviderModule = { createWebProvider(options: { app: unknown; device?: unknown; logger: Logger; worker?: WorkerInfo }): DeviceProvider };

export async function createProvider(platform: Platform, config: QuiescoConfig, logger: Logger, worker: WorkerInfo = SERIAL_WORKER): Promise<DeviceProvider> {
  switch (platform) {
    case 'android': {
      const app = config.apps.android;
      if (app === undefined) throw new QuiescoError('CONFIG_ERROR', 'apps.android is missing in quiesco.config');
      return new AndroidProvider({ app, ...(config.devices?.android !== undefined ? { device: config.devices.android } : {}), logger, worker });
    }
    case 'web': {
      const app = config.apps.web;
      if (app === undefined) throw new QuiescoError('CONFIG_ERROR', 'apps.web is missing in quiesco.config');
      const pkg = PROVIDER_PACKAGES.web as { name: string; install: string };
      let mod: ProviderModule;
      try {
        // A variable specifier: the web provider (and Playwright) stay optional for native-only projects.
        const specifier: string = pkg.name;
        mod = (await import(specifier)) as ProviderModule;
      } catch (e) {
        throw new QuiescoError('CONFIG_ERROR', `Testing on the web needs ${pkg.name} (${(e as Error).message}). Install it: ${pkg.install}`);
      }
      return mod.createWebProvider({ app, ...(config.devices?.web !== undefined ? { device: config.devices.web } : {}), logger, worker });
    }
    case 'ios': {
      const app = config.apps.ios;
      if (app === undefined) throw new QuiescoError('CONFIG_ERROR', 'apps.ios is missing in quiesco.config');
      return new IosProvider({ app, ...(config.devices?.ios !== undefined ? { device: config.devices.ios } : {}), logger, worker });
    }
  }
}

export class Session {
  readonly driver: Driver;
  readonly device: DeviceApi;
  /** Per-scenario video, logs, timeline and saved screenshots (Phase 6.9). */
  readonly artifacts: Artifacts;
  readonly sync: SyncApi;
  private connection: AgentConnection | null = null;
  /** What the test did to the app (Phase 6.5); element calls need `running`. */
  private appState: AppRunState = 'running';
  /** `app.device.setNetwork('offline')`: merged into every agent config sent (Phase 6.6). */
  private offline = false;
  private readonly defaultArgs: LaunchArgs;

  private constructor(
    readonly config: QuiescoConfig,
    readonly provider: DeviceProvider,
    readonly server: QuiescoServer,
    readonly launchParams: LaunchParams,
    private readonly logger: Logger,
    readonly worker: WorkerInfo = SERIAL_WORKER,
  ) {
    this.defaultArgs = config.launchArgs === undefined ? {} : checkLaunchArgs(config.launchArgs, 'config launchArgs');
    this.artifacts = new Artifacts({ ...(config.artifacts !== undefined ? { config: config.artifacts } : {}), provider, logger, worker });
    this.driver = new Driver({
      timeline: this.artifacts.timeline,
      provider,
      connection: () => this.currentConnection(),
      defaultTimeoutMs: toAgentConfig(config).sync.timeoutMs,
      ...(config.actions?.mode !== undefined ? { mode: config.actions.mode } : {}),
      ignoreAppErrors: ignoredAppErrors(config),
      logger,
      appState: () => this.appState,
    });
    const baseAgentConfig = server.agentConfig;
    this.sync = new SyncApi({
      base: () => baseAgentConfig,
      apply: (c) => this.applyAgentConfig(c),
    });
    this.device = new DeviceApi(this.deviceHost());
    this.driver.setLifecycle(this.device, this.sync);
  }

  /** Start the server, boot the device, install and launch the app, and wait until the agent connects. */
  static async create(options: SessionOptions): Promise<Session> {
    const logger = options.logger ?? consoleLogger;
    const { config } = options;
    const worker = options.worker ?? SERIAL_WORKER;
    // The provider first: the agent config carries its gesture thresholds.
    const provider: DeviceProvider = options.provider ?? (await createProvider(options.platform, config, logger, worker));
    const server = new QuiescoServer({
      port: serverPort(config, worker.index),
      agentConfig: toAgentConfig(config, provider.gestureSlop, worker.index),
      logger,
      ...(config.server?.host !== undefined ? { host: config.server.host } : {}),
    });
    const port = await server.start();
    const sessionId = randomUUID();
    // JS-only builds cannot read launch parameters and say `sessionId: null`; accept them for this session.
    server.expectSession(sessionId, { acceptAnonymous: true });
    const session = new Session(config, provider, server, { port, sessionId }, logger, worker);
    try {
      await provider.boot();
      await provider.install();
      if (config.permissions !== undefined && config.permissions.length > 0) await provider.grantPermissions(config.permissions);
      await session.launch();
    } catch (e) {
      await session.dispose().catch(() => undefined);
      throw e;
    }
    return session;
  }

  /**
   * Before each scenario: undo the previous scenario's `app.sync.*` and device-state changes, bring a backgrounded app
   * back / start a terminated one, then soft reset — or terminate + relaunch for `@hard-reset` (or
   * `reset.default: 'hard'`).
   */
  async beforeScenario(info: ScenarioInfo = {}): Promise<void> {
    try {
      await this.resetForScenario(info);
    } catch (e) {
      // The app went away during the previous scenario (or this reset) and did not come back in time, or
      // dropped the reset request:
      // start it again rather than failing every scenario that follows on the same lost connection
      // (Phase 6.12: a font-scale relaunch on a busy machine took over 30 s, then 9 scenarios failed).
      // AGENT_TIMEOUT: still connected but not answering, e.g. left suspended in the background when the
      // previous scenario's notification tap did not bring it back (batch D 2026-11-13).
      if (!(e instanceof QuiescoError) || !RESTART_ON.has(e.errorName)) throw e;
      this.logger.warn(`the app is gone or not answering (${e.message.split('\n')[0]}); starting it again for this scenario`);
      await this.provider.terminate().catch(() => undefined);
      this.appState = 'terminated';
      await this.launch({}, { recovering: true });
      this.appState = 'running';
    }
  }

  private async resetForScenario(info: ScenarioInfo): Promise<void> {
    await this.sync.reset();
    await this.device.resetDeviceState(this.config.permissions ?? []);
    const hard = info.tags?.includes(tagNames(this.config.tags).hardReset) === true || this.config.reset?.default === 'hard';
    if (hard || this.appState === 'terminated') {
      await this.provider.terminate();
      this.appState = 'terminated';
      await this.launch();
      this.appState = 'running';
      return;
    }
    if (this.appState === 'background') await this.device.bringToForeground();
    await this.driver.reset();
  }

  /**
   * Start a scenario's artifacts (timeline, video). Call before `beforeScenario` so its reset is in the
   * video; `afterScenario` ends them.
   */
  async startScenario(info: ScenarioInfo = {}): Promise<void> {
    this.driver.lastFailure = null;
    await this.artifacts.beginScenario(info.name ?? 'scenario');
  }

  /**
   * End a scenario: on failure the evidence (screenshot with the failed step's elements framed, element
   * tree, idle state), plus video / logs / timeline per the artifacts policy, as attachments.
   */
  async afterScenario(result: { failed: boolean }): Promise<ScenarioArtifacts> {
    const evidence: Attachment[] = [];
    if (result.failed) {
      const ev = await this.collectEvidence();
      if (ev.screenshot !== undefined) evidence.push({ data: ev.screenshot, mediaType: 'image/png', fileName: 'failure.png' });
      if (ev.tree !== undefined) evidence.push({ data: JSON.stringify({ elementTree: ev.tree }, null, 2), mediaType: 'application/json', fileName: 'element-tree.json' });
      if (ev.idle !== undefined) evidence.push({ data: JSON.stringify({ idleState: ev.idle }, null, 2), mediaType: 'application/json', fileName: 'idle-state.json' });
      if (ev.errors.length > 0) evidence.push({ data: `Quiesco could not collect: ${ev.errors.join('; ')}`, mediaType: 'text/plain', fileName: 'evidence-errors.txt' });
    }
    return this.artifacts.endScenario({ failed: result.failed, evidence });
  }

  /** Best effort: each piece is collected independently, failures are listed in `errors`. */
  async collectEvidence(): Promise<Evidence> {
    const ev: Evidence = { errors: [] };
    await Promise.all([
      this.provider.screenshot().then(
        async (b) => (ev.screenshot = await this.framed(b)),
        (e: unknown) => ev.errors.push(`screenshot: ${(e as Error).message}`),
      ),
      this.driver.getTree().then(
        (t) => (ev.tree = t),
        (e: unknown) => ev.errors.push(`element tree: ${(e as Error).message}`),
      ),
      this.driver.getIdleState().then(
        (s) => (ev.idle = s),
        (e: unknown) => ev.errors.push(`idle state: ${(e as Error).message}`),
      ),
    ]);
    return ev;
  }

  /** The screenshot with the last failed call's elements framed in red (unchanged when it named none). */
  private async framed(png: Buffer): Promise<Buffer> {
    const rects = failureRects(this.driver.lastFailure?.data);
    if (rects.length === 0) return png;
    try {
      const info = await this.driver.request('deviceInfo', {}, 3_000);
      return highlight(png, rects, info.window.width);
    } catch {
      return png;
    }
  }

  async dispose(): Promise<void> {
    await this.artifacts.dispose().catch(() => undefined);
    // Leave the device as it was: undo the last scenario's device-state changes (best effort).
    await this.device.resetDeviceState(this.config.permissions ?? [], { relaunch: false }).catch((e: unknown) =>
      this.logger.warn(`restoring the device state failed: ${(e as Error).message}`),
    );
    await this.server.stop();
    await this.provider.shutdown().catch((e: unknown) => this.logger.warn(`device shutdown failed: ${(e as Error).message}`));
  }

  /**
   * The open connection; after a disconnect (web page reload, app restart) waits for the app to come
   * back within the connect timeout.
   */
  private async currentConnection(): Promise<AgentConnection> {
    const c = this.connection;
    if (c !== null && !c.closed) return c;
    const timeoutMs = this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const conn = await this.server.waitForConnection(
      this.launchParams.sessionId,
      timeoutMs,
      () => `The app disconnected and did not reconnect within ${timeoutMs}ms (did it crash or get closed?)`,
      c,
    );
    this.adopt(conn);
    return conn;
  }

  private adopt(conn: AgentConnection): void {
    if (this.connection === conn) return;
    this.connection = conn;
    conn.on('log', (l) => this.logger[l.level](`[app] ${l.message}`));
    this.driver.attach(conn);
  }

  /** The session's connection parameters plus this launch's arguments (merged over the config's) and URL. */
  private paramsFor(extra: { args?: LaunchArgs; url?: string }): LaunchParams {
    const args = { ...this.defaultArgs, ...extra.args };
    const out: LaunchParams = { ...this.launchParams };
    if (Object.keys(args).length > 0) {
      out.args = encodeLaunchArgs(args);
      out.argsObject = args;
    }
    if (extra.url !== undefined) out.url = extra.url;
    return out;
  }

  private deviceHost(): DeviceHost {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the host object reads live session state
    const session = this;
    return {
      provider: this.provider,
      logger: this.logger,
      permissions: this.config.permissions ?? [],
      get appState() {
        return session.appState;
      },
      set appState(s: AppRunState) {
        session.appState = s;
      },
      launch: async (extra) => {
        const urlHandling = await this.launch(extra);
        return { nativeModule: (await this.currentConnection()).info.nativeModule, urlHandling };
      },
      deviceInfo: (timeoutMs) => this.driver.request('deviceInfo', {}, timeoutMs),
      suspendInApp: async () => (await this.driver.request('suspend', {}, 3_000)).suspended,
      setOrientationInApp: (orientation) => this.driver.request('setOrientation', { orientation }, 5_000),
      getClipboardInApp: () => this.driver.request('getClipboard', {}, 5_000),
      setClipboardInApp: (text) => this.driver.request('setClipboard', { text }, 5_000),
      postNotificationInApp: (n) => this.driver.request('postNotification', { title: n.title, body: n.body ?? '', data: n.data ?? {} }, 5_000),
      setOffline: async (offline) => {
        this.offline = offline;
        await this.applyAgentConfig(this.sync.current());
      },
      reapplyConfig: () => this.pushAgentConfig(),
      waitForIdle: async () => {
        await this.driver.waitForIdle();
      },
      elementRect: async (target) => {
        const el = await this.driver.attributes(target);
        if (el.rect === null || el.rect.width <= 0 || el.rect.height <= 0) {
          throw new QuiescoError('DEVICE_ERROR', `cannot take a screenshot of an element without a size (${el.testID ?? el.type})`);
        }
        return el.rect;
      },
      openUrl: (url) => this.driver.openUrl(url),
      pressBack: () => this.driver.pressBack(),
      scrollView: (matcher, to, indicators) =>
        this.driver.request('scrollView', { ...(matcher !== undefined ? { matcher } : {}), ...(to !== undefined ? { to } : {}), ...(indicators !== undefined ? { indicators } : {}) }),
      saveArtifact: (name, data, mediaType, ext) => this.artifacts.save(name, data, mediaType, ext),
    };
  }

  /** `app.sync.*`: the next hello carries `config`; a connected, running app gets it now. */
  private async applyAgentConfig(config: AgentConfig): Promise<void> {
    this.server.agentConfig = this.offline ? { ...config, network: { offline: true } } : config;
    if (this.appState === 'running') await this.pushAgentConfig();
  }

  private async pushAgentConfig(): Promise<void> {
    const c = this.connection;
    if (c === null || c.closed) return; // the reconnect's hello carries it
    await this.driver.request('configure', { config: this.server.agentConfig });
  }

  private async launch(extra: { args?: LaunchArgs; url?: string } = {}, how: { recovering?: boolean } = {}): Promise<LaunchUrlHandling | void> {
    const previous = this.connection;
    const params = this.paramsFor(extra);
    const urlHandling = await this.provider.launch(params);
    // A start after the app was lost is as slow as the first (Android is still busy compiling it).
    const timeoutMs = launchConnectTimeout(this.config, { first: previous === null || how.recovering === true });
    let conn: AgentConnection;
    try {
      conn = await this.server.waitForConnection(this.launchParams.sessionId, timeoutMs, () => '', previous);
    } catch (e) {
      if (!(e instanceof QuiescoError) || e.errorName !== 'CONNECT_TIMEOUT') throw e;
      const diag = this.provider.diagnose === undefined
        ? []
        : await this.provider.diagnose(params).catch((d: unknown) => [`(diagnostics failed: ${(d as Error).message})`]);
      throw new QuiescoError('CONNECT_TIMEOUT', this.timeoutMessage(timeoutMs, diag), e.data);
    }
    this.adopt(conn);
    return urlHandling;
  }

  private timeoutMessage(timeoutMs: number, extra: string[]): string {
    const { port, sessionId } = this.launchParams;
    const lines = [
      `The app did not connect to ws://localhost:${port} within ${timeoutMs}ms (session ${sessionId}).`,
      'Check:',
      '  - The JS bundle is an e2e build: EXPO_PUBLIC_QUIESCO=1 and metro.config.js wraps the config with withQuiesco().',
      "  - The app entry imports '@quiesco/agent' on its first line and renders <QuiescoRoot>.",
      `  - Without @quiesco/native the app connects to the build-time port (EXPO_PUBLIC_QUIESCO_PORT, default 7357); the host listens on ${port}.`,
      ...extra.map((l) => `  - ${l}`),
    ];
    if (this.server.rejected.length > 0) {
      lines.push('Refused connections:', ...this.server.rejected.map((r) => `  - ${r.reason}`));
    }
    return lines.join('\n');
  }
}

export function createSession(options: SessionOptions): Promise<Session> {
  return Session.create(options);
}
