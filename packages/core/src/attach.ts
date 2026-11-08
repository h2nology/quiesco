/**
 * Attach to an app that is already running (requirements.md §6.12 `quiesco tree`): start only the
 * WebSocket server on the configured port and take the first agent that connects, whatever session
 * it presents. No device is booted and nothing is installed or launched, so the app stays on the
 * screen the user navigated to.
 *
 * The agent reconnects with backoff while the host is away (after a test run, or when the app was
 * started by hand and connects to the build-time port), so it shows up within a couple of seconds.
 */
import type { Platform, TreeNode } from '@quiesco/protocol';

import type { QuiescoConfig } from './config.js';
import { DEFAULT_CONNECT_TIMEOUT_MS, serverPort, toAgentConfig } from './config.js';
import type { Logger } from './logger.js';
import { silentLogger } from './logger.js';
import { QuiescoServer } from './server/ws-server.js';

const ATTACH_SESSION = 'attach';
const REQUEST_TIMEOUT_MS = 15_000;

export interface AttachOptions {
  config: QuiescoConfig;
  /** How long to wait for the app. Default: `connectTimeoutMs` from the config (30 s). */
  timeoutMs?: number;
  logger?: Logger;
  /** Called once the server listens (e.g. to tell the user which port the app must reach). */
  onListening?: (port: number) => void;
}

export interface AttachedApp {
  readonly platform: Platform;
  readonly port: number;
  getTree(): Promise<TreeNode | null>;
  close(): Promise<void>;
}

export async function attachToRunningApp(options: AttachOptions): Promise<AttachedApp> {
  const { config } = options;
  const logger = options.logger ?? silentLogger;
  const server = new QuiescoServer({
    port: serverPort(config),
    agentConfig: toAgentConfig(config),
    logger,
    ...(config.server?.host !== undefined ? { host: config.server.host } : {}),
  });
  const port = await server.start();
  server.expectSession(ATTACH_SESSION, { acceptAny: true, acceptAnonymous: true });
  options.onListening?.(port);
  const timeoutMs = options.timeoutMs ?? config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  try {
    const connection = await server.waitForConnection(
      ATTACH_SESSION,
      timeoutMs,
      () =>
        `No app connected to ws://localhost:${port} within ${timeoutMs}ms. Start the e2e build of the app ` +
        '(EXPO_PUBLIC_QUIESCO=1) so it connects to this port, or use --launch to let Quiesco launch it.',
    );
    return {
      platform: connection.platform,
      port,
      async getTree() {
        return (await connection.request('getTree', {}, REQUEST_TIMEOUT_MS)).root;
      },
      close: () => server.stop(),
    };
  } catch (e) {
    await server.stop();
    throw e;
  }
}
