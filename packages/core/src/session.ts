/**
 * Runner-agnostic session API (requirements.md §6.10 "运行器无关"). A runner adapter maps its lifecycle
 * onto it: createSession (BeforeAll) → beforeScenario (Before) → collectEvidence (After, on failure)
 * → dispose (AfterAll). Nothing here knows about Cucumber.
 */
import { randomUUID } from 'node:crypto';

import type { Platform, TrackerState, TreeNode } from '@quiesco/protocol';

import type { QuiescoConfig } from './config.js';
import { DEFAULT_CONNECT_TIMEOUT_MS, serverPort, toAgentConfig } from './config.js';
import { AndroidProvider } from './devices/android.js';
import type { DeviceProvider, LaunchParams } from './devices/provider.js';
import { Driver } from './driver.js';
import { QuiescoError } from './errors.js';
import type { Logger } from './logger.js';
import { consoleLogger } from './logger.js';
import type { AgentConnection } from './server/ws-server.js';
import { QuiescoServer } from './server/ws-server.js';

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

export const HARD_RESET_TAG = '@hard-reset';

export function createProvider(platform: Platform, config: QuiescoConfig, logger: Logger): DeviceProvider {
  switch (platform) {
    case 'android': {
      const app = config.apps.android;
      if (app === undefined) throw new QuiescoError('CONFIG_ERROR', 'apps.android is missing in quiesco.config');
      return new AndroidProvider({ app, ...(config.devices?.android !== undefined ? { device: config.devices.android } : {}), logger });
    }
    case 'ios':
    case 'web':
      throw new QuiescoError('CONFIG_ERROR', `The ${platform} device provider is not implemented yet`);
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
      connection: () => {
        if (this.connection === null || this.connection.closed) {
          throw new QuiescoError('AGENT_DISCONNECTED', 'The app is not connected (did it crash or get closed?)');
        }
        return this.connection;
      },
      defaultTimeoutMs: toAgentConfig(config).sync.timeoutMs,
      ...(config.actions?.mode !== undefined ? { mode: config.actions.mode } : {}),
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
    const provider = options.provider ?? createProvider(options.platform, config, logger);
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
    const hard = info.tags?.includes(HARD_RESET_TAG) === true || this.config.reset?.default === 'hard';
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
    this.connection = conn;
    conn.on('log', (l) => this.logger[l.level](`[app] ${l.message}`));
    this.driver.attach(conn);
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
