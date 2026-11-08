/**
 * Runner-agnostic session API (requirements.md §6.10 "运行器无关"). A runner adapter maps its lifecycle
 * onto it: createSession (BeforeAll) → beforeScenario (Before) → collectEvidence (After, on failure)
 * → dispose (AfterAll). Nothing here knows about Cucumber.
 */
import { randomUUID } from 'node:crypto';

import type { Platform, TrackerState, TreeNode } from '@quiesco/protocol';

import type { QuiescoConfig } from './config.js';
import { DEFAULT_CONNECT_TIMEOUT_MS, ignoredAppErrors, serverPort, toAgentConfig } from './config.js';
import { AndroidProvider } from './devices/android.js';
import { IosProvider } from './devices/ios.js';
import type { DeviceProvider, LaunchParams } from './devices/provider.js';
import { Driver } from './driver.js';
import { QuiescoError } from './errors.js';
import type { Logger } from './logger.js';
import { consoleLogger } from './logger.js';
import type { AgentConnection } from './server/ws-server.js';
import { QuiescoServer } from './server/ws-server.js';
import { tagNames } from './tags.js';

export interface SessionOptions {
  config: QuiescoConfig;
  platform: Platform;
  /** Parallel worker index; worker N listens on `server.port + N`. */
  workerIndex?: number;
  logger?: Logger;
  /** Override the device provider (tests, custom providers). */
  provider?: DeviceProvider;
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
}

/** Packages providing a platform's DeviceProvider, loaded at runtime (core never imports them statically). */
const PROVIDER_PACKAGES: Partial<Record<Platform, { name: string; install: string }>> = {
  web: { name: '@quiesco/web', install: 'npm i -D @quiesco/web playwright && npx playwright install chromium' },
};

type ProviderModule = { createWebProvider(options: { app: unknown; device?: unknown; logger: Logger }): DeviceProvider };

export async function createProvider(platform: Platform, config: QuiescoConfig, logger: Logger): Promise<DeviceProvider> {
  switch (platform) {
    case 'android': {
      const app = config.apps.android;
      if (app === undefined) throw new QuiescoError('CONFIG_ERROR', 'apps.android is missing in quiesco.config');
      return new AndroidProvider({ app, ...(config.devices?.android !== undefined ? { device: config.devices.android } : {}), logger });
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
      return mod.createWebProvider({ app, ...(config.devices?.web !== undefined ? { device: config.devices.web } : {}), logger });
    }
    case 'ios': {
      const app = config.apps.ios;
      if (app === undefined) throw new QuiescoError('CONFIG_ERROR', 'apps.ios is missing in quiesco.config');
      return new IosProvider({ app, ...(config.devices?.ios !== undefined ? { device: config.devices.ios } : {}), logger });
    }
  }
}

export class Session {
  readonly driver: Driver;
  private connection: AgentConnection | null = null;

  private constructor(
    readonly config: QuiescoConfig,
    readonly provider: DeviceProvider,
    readonly server: QuiescoServer,
    readonly launchParams: LaunchParams,
    private readonly logger: Logger,
  ) {
    this.driver = new Driver({
      provider,
      connection: () => this.currentConnection(),
      defaultTimeoutMs: toAgentConfig(config).sync.timeoutMs,
      ...(config.actions?.mode !== undefined ? { mode: config.actions.mode } : {}),
      ignoreAppErrors: ignoredAppErrors(config),
      logger,
    });
  }

  /** Start the server, boot the device, install and launch the app, and wait until the agent connects. */
  static async create(options: SessionOptions): Promise<Session> {
    const logger = options.logger ?? consoleLogger;
    const { config } = options;
    const server = new QuiescoServer({
      port: serverPort(config, options.workerIndex),
      agentConfig: toAgentConfig(config),
      logger,
      ...(config.server?.host !== undefined ? { host: config.server.host } : {}),
    });
    const port = await server.start();
    let provider: DeviceProvider;
    try {
      provider = options.provider ?? (await createProvider(options.platform, config, logger));
    } catch (e) {
      await server.stop();
      throw e;
    }
    const sessionId = randomUUID();
    // JS-only builds cannot read launch parameters and say `sessionId: null`; accept them for this session.
    server.expectSession(sessionId, { acceptAnonymous: true });
    const session = new Session(config, provider, server, { port, sessionId }, logger);
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

  /** Before each scenario: soft reset, or terminate + relaunch for `@hard-reset` (or `reset.default: 'hard'`). */
  async beforeScenario(info: ScenarioInfo = {}): Promise<void> {
    const hard = info.tags?.includes(tagNames(this.config.tags).hardReset) === true || this.config.reset?.default === 'hard';
    if (hard) {
      await this.provider.terminate();
      await this.launch();
      return;
    }
    await this.driver.reset();
  }

  /** Best effort: each piece is collected independently, failures are listed in `errors`. */
  async collectEvidence(): Promise<Evidence> {
    const ev: Evidence = { errors: [] };
    await Promise.all([
      this.provider.screenshot().then(
        (b) => (ev.screenshot = b),
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

  async dispose(): Promise<void> {
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

  private async launch(): Promise<void> {
    const previous = this.connection;
    await this.provider.launch(this.launchParams);
    const timeoutMs = this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    let conn: AgentConnection;
    try {
      conn = await this.server.waitForConnection(this.launchParams.sessionId, timeoutMs, () => '', previous);
    } catch (e) {
      if (!(e instanceof QuiescoError) || e.errorName !== 'CONNECT_TIMEOUT') throw e;
      const extra = this.provider.diagnose === undefined
        ? []
        : await this.provider.diagnose(this.launchParams).catch((d: unknown) => [`(diagnostics failed: ${(d as Error).message})`]);
      throw new QuiescoError('CONNECT_TIMEOUT', this.timeoutMessage(timeoutMs, extra), e.data);
    }
    this.adopt(conn);
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
