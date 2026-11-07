/**
 * WebSocket server the agents connect to (requirements.md §6.9, §7).
 *
 * Handshake: the agent's first message must be `hello`. The server checks the protocol version
 * (4002 on mismatch) and the session id (4001 if unknown). A `null` session id — JS-only builds, which
 * cannot read launch parameters — is accepted when exactly one expected session allows it. A second
 * connection for the same session replaces the first (4003), e.g. after a web page reload.
 */
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';

import { CloseCode, ErrorCode, JsonRpcErrorCode, PROTOCOL_VERSION } from '@quiesco/protocol';
import type { AgentConfig, AgentEvents, AgentMethods, HostMethods, ParamsOf, Platform, ResultOf } from '@quiesco/protocol';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import { QuiescoError } from '../errors.js';
import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';

export type HelloParams = ParamsOf<HostMethods['hello']>;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: NodeJS.Timeout;
  method: string;
}

/** A handshaken agent. Emits `log`, `error` (app errors) and `close`. */
export class AgentConnection extends EventEmitter<{
  log: [AgentEvents['log']];
  appError: [AgentEvents['error']];
  close: [code: number, reason: string];
}> {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private _closed = false;

  constructor(
    private readonly socket: WebSocket,
    readonly sessionId: string,
    readonly info: HelloParams,
  ) {
    super();
  }

  get platform(): Platform {
    return this.info.platform;
  }

  get closed(): boolean {
    return this._closed;
  }

  /** Call an agent method. `timeoutMs` is wall-clock: a blocked JS thread cannot answer at all. */
  request<M extends keyof AgentMethods>(method: M, params: ParamsOf<AgentMethods[M]>, timeoutMs: number): Promise<ResultOf<AgentMethods[M]>> {
    if (this._closed) {
      return Promise.reject(new QuiescoError('AGENT_DISCONNECTED', `Cannot call ${method}: the app is not connected`, { method }));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new QuiescoError(
            'AGENT_TIMEOUT',
            `The app did not answer ${method} within ${timeoutMs}ms. Its JS thread may be blocked by a long task, or the app crashed.`,
            { method, timeoutMs },
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, method });
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  close(code: number = CloseCode.NORMAL, reason = ''): void {
    this.socket.close(code, reason);
    this.onClosed(code, reason);
  }

  /** @internal */
  onMessage(msg: { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { code: number; message: string; data?: unknown } }): void {
    if (typeof msg.id === 'number' && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (p === undefined) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error !== undefined) p.reject(QuiescoError.fromRpc(msg.error));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'log') this.emit('log', msg.params as AgentEvents['log']);
    else if (msg.method === 'error') this.emit('appError', msg.params as AgentEvents['error']);
  }

  /** @internal */
  onClosed(code: number, reason: string): void {
    if (this._closed) return;
    this._closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new QuiescoError('AGENT_DISCONNECTED', `The app disconnected while handling ${p.method} (close code ${code})`, { method: p.method, code }));
    }
    this.pending.clear();
    this.emit('close', code, reason);
  }
}

export interface ServerOptions {
  port: number;
  host?: string;
  agentConfig: AgentConfig;
  logger?: Logger;
}

export interface RejectedHello {
  at: number;
  reason: string;
}

interface Expected {
  acceptAnonymous: boolean;
  connection: AgentConnection | null;
  waiters: ((c: AgentConnection) => void)[];
}

export class QuiescoServer {
  private wss: WebSocketServer | null = null;
  private readonly sessions = new Map<string, Expected>();
  /** Handshakes refused recently (shown in connection-timeout diagnostics). */
  readonly rejected: RejectedHello[] = [];
  private readonly logger: Logger;
  private _port = 0;

  constructor(private readonly options: ServerOptions) {
    this.logger = options.logger ?? silentLogger;
  }

  get port(): number {
    return this._port;
  }

  async start(): Promise<number> {
    const wss = new WebSocketServer({ port: this.options.port, ...(this.options.host !== undefined ? { host: this.options.host } : {}) });
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', (e) =>
        reject(new QuiescoError('CONFIG_ERROR', `Cannot listen on port ${this.options.port}: ${(e as Error).message}`, { port: this.options.port })),
      );
    });
    this.wss = wss;
    this._port = (wss.address() as AddressInfo).port;
    wss.on('connection', (socket) => this.onSocket(socket));
    return this._port;
  }

  async stop(): Promise<void> {
    for (const s of this.sessions.values()) s.connection?.close(CloseCode.NORMAL, 'host stopped');
    const wss = this.wss;
    this.wss = null;
    if (wss === null) return;
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }

  /** Register a session the server will accept. */
  expectSession(sessionId: string, options: { acceptAnonymous?: boolean } = {}): void {
    if (!this.sessions.has(sessionId)) this.sessions.set(sessionId, { acceptAnonymous: options.acceptAnonymous ?? false, connection: null, waiters: [] });
  }

  connection(sessionId: string): AgentConnection | null {
    const c = this.sessions.get(sessionId)?.connection ?? null;
    return c !== null && !c.closed ? c : null;
  }

  /**
   * Resolves with the current connection, or the next one for this session. `exclude` skips a
   * connection that is about to go away (the old app process during a hard reset).
   */
  waitForConnection(sessionId: string, timeoutMs: number, describeTimeout: () => string, exclude: AgentConnection | null = null): Promise<AgentConnection> {
    const s = this.sessions.get(sessionId);
    if (s === undefined) return Promise.reject(new Error(`unknown session ${sessionId}`));
    const current = this.connection(sessionId);
    if (current !== null && current !== exclude) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      const waiter = (c: AgentConnection): void => {
        clearTimeout(timer);
        resolve(c);
      };
      const timer = setTimeout(() => {
        s.waiters = s.waiters.filter((w) => w !== waiter);
        reject(new QuiescoError('CONNECT_TIMEOUT', describeTimeout(), { sessionId, timeoutMs, port: this._port }));
      }, timeoutMs);
      s.waiters.push(waiter);
    });
  }

  private onSocket(socket: WebSocket): void {
    let connection: AgentConnection | null = null;
    socket.on('message', (data) => {
      let msg: { id?: unknown; method?: unknown; params?: unknown };
      try {
        msg = JSON.parse(String(data)) as typeof msg;
      } catch {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: JsonRpcErrorCode.PARSE_ERROR, message: 'invalid JSON' } }));
        return;
      }
      if (connection !== null) {
        connection.onMessage(msg as Parameters<AgentConnection['onMessage']>[0]);
        return;
      }
      connection = this.handshake(socket, msg);
    });
    socket.on('close', (code, reason) => connection?.onClosed(code, reason.toString()));
    socket.on('error', (e) => this.logger.debug(`agent socket error: ${e.message}`));
  }

  private refuse(socket: WebSocket, id: unknown, closeCode: number, code: number, message: string, data: Record<string, unknown>): null {
    this.rejected.push({ at: Date.now(), reason: message });
    if (this.rejected.length > 20) this.rejected.shift();
    this.logger.warn(message);
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message, data } }));
    socket.close(closeCode, message.slice(0, 120));
    return null;
  }

  private handshake(socket: WebSocket, msg: { id?: unknown; method?: unknown; params?: unknown }): AgentConnection | null {
    if (msg.method !== 'hello' || typeof msg.params !== 'object' || msg.params === null) {
      return this.refuse(socket, msg.id, 1008, JsonRpcErrorCode.INVALID_REQUEST, 'The first message must be hello', {});
    }
    const hello = msg.params as HelloParams;
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      const older = hello.protocolVersion < PROTOCOL_VERSION ? '@quiesco/agent' : '@quiesco/core';
      return this.refuse(
        socket,
        msg.id,
        CloseCode.PROTOCOL_MISMATCH,
        ErrorCode.PROTOCOL_MISMATCH,
        `Protocol mismatch: host speaks v${PROTOCOL_VERSION}, agent v${hello.protocolVersion}. Upgrade ${older} so both match.`,
        { name: 'PROTOCOL_MISMATCH', host: PROTOCOL_VERSION, agent: hello.protocolVersion },
      );
    }
    const sessionId = this.matchSession(hello.sessionId);
    if (sessionId === null) {
      return this.refuse(
        socket,
        msg.id,
        CloseCode.SESSION_MISMATCH,
        ErrorCode.SESSION_MISMATCH,
        `Unknown session ${JSON.stringify(hello.sessionId)} (expected ${[...this.sessions.keys()].join(', ') || 'none'}). Is another test run using this port?`,
        { name: 'SESSION_MISMATCH', expected: [...this.sessions.keys()], received: hello.sessionId },
      );
    }
    const s = this.sessions.get(sessionId) as Expected;
    if (s.connection !== null && !s.connection.closed) s.connection.close(CloseCode.REPLACED, 'replaced by a newer connection');
    const connection = new AgentConnection(socket, sessionId, hello);
    s.connection = connection;
    const result: ResultOf<HostMethods['hello']> = { accepted: true, sessionId, config: this.options.agentConfig };
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    this.logger.debug(`agent connected: ${hello.platform}, session ${sessionId}, agent ${hello.agentVersion}, native module ${hello.nativeModule}`);
    for (const w of s.waiters.splice(0)) w(connection);
    return connection;
  }

  private matchSession(received: string | null): string | null {
    if (received !== null) return this.sessions.has(received) ? received : null;
    const anonymous = [...this.sessions.entries()].filter(([, s]) => s.acceptAnonymous);
    return anonymous.length === 1 ? (anonymous[0] as [string, Expected])[0] : null;
  }
}
