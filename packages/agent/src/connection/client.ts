/**
 * WebSocket JSON-RPC client of the agent (requirements.md §7).
 * - On open: send `hello`; the host answers with the session id and the agent config, or closes the
 *   socket with a 4xxx code (session / protocol mismatch, replaced by a newer connection).
 * - Host → agent requests are dispatched to `handle` and answered with `result` or `error`.
 * - Agent → host events are notifications; they are buffered until the handshake completes.
 * - Reconnects with backoff after unexpected closes (Metro reload, host restart, network blip).
 */
import { CloseCode, JsonRpcErrorCode, PROTOCOL_VERSION } from '@quiesco/protocol';
import type {
  AgentConfig,
  AgentEventName,
  AgentEvents,
  HostMethods,
  JsonRpcFailure,
  JsonRpcRequest,
  JsonRpcSuccess,
  ParamsOf,
  ResultOf,
} from '@quiesco/protocol';

import { QuiescoError } from '../errors';
import type { SocketLike } from '../platform';
import type { Clock } from '../sync';
import type { ConnectionParams } from './params';

export type HelloInfo = Omit<ParamsOf<HostMethods['hello']>, 'sessionId' | 'protocolVersion'>;
export type RequestHandler = (method: string, params: unknown) => Promise<unknown>;
export type ClientState = 'idle' | 'connecting' | 'handshaking' | 'ready' | 'rejected' | 'stopped';

export interface AgentClientOptions {
  params: ConnectionParams;
  hello: HelloInfo;
  createSocket: (url: string) => SocketLike;
  handle: RequestHandler;
  onReady?: (config: AgentConfig) => void;
  clock: Clock;
  /** Diagnostics sink (defaults to nothing; the runtime wires it to the original console). */
  log?: (message: string) => void;
}

const HELLO_ID = 'hello';
const BACKOFF_MS = [250, 500, 1000, 2000];
const MAX_BUFFERED_EVENTS = 100;
/** Close codes after which reconnecting is pointless. */
const FINAL_CODES: ReadonlySet<number> = new Set([CloseCode.SESSION_MISMATCH, CloseCode.PROTOCOL_MISMATCH, CloseCode.REPLACED]);

type Incoming = Partial<JsonRpcRequest & JsonRpcSuccess & JsonRpcFailure>;

export class AgentClient {
  private socket: SocketLike | null = null;
  private _state: ClientState = 'idle';
  private attempt = 0;
  private retryTimer: unknown = null;
  private readonly buffer: string[] = [];

  constructor(private readonly options: AgentClientOptions) {}

  get state(): ClientState {
    return this._state;
  }

  get url(): string {
    return `ws://localhost:${this.options.params.port}`;
  }

  start(): void {
    if (this._state !== 'idle' && this._state !== 'stopped') return;
    this.connect();
  }

  stop(): void {
    this._state = 'stopped';
    if (this.retryTimer !== null) this.options.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const s = this.socket;
    this.socket = null;
    s?.close(CloseCode.NORMAL, 'agent stopped');
  }

  notify<E extends AgentEventName>(event: E, params: AgentEvents[E]): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method: event, params });
    if (this._state === 'ready' && this.socket !== null) {
      this.socket.send(msg);
      return;
    }
    this.buffer.push(msg);
    if (this.buffer.length > MAX_BUFFERED_EVENTS) this.buffer.shift();
  }

  private connect(): void {
    this._state = 'connecting';
    let socket: SocketLike;
    try {
      socket = this.options.createSocket(this.url);
    } catch (e) {
      this.options.log?.(`cannot create WebSocket to ${this.url}: ${String(e)}`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this._state = 'handshaking';
      const params: ParamsOf<HostMethods['hello']> = {
        ...this.options.hello,
        sessionId: this.options.params.session,
        protocolVersion: PROTOCOL_VERSION,
      };
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: HELLO_ID, method: 'hello', params }));
    };
    socket.onmessage = (ev) => {
      if (this.socket === socket) this.onMessage(socket, ev.data);
    };
    socket.onerror = () => {
      // onclose follows; nothing to do here.
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this._state === 'stopped') return;
      if (FINAL_CODES.has(ev.code)) {
        this._state = 'rejected';
        this.options.log?.(`host closed the connection (${ev.code}${ev.reason ? `: ${ev.reason}` : ''}); not reconnecting`);
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this._state = 'connecting';
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] as number;
    this.attempt++;
    this.retryTimer = this.options.clock.setTimeout(() => {
      this.retryTimer = null;
      if (this._state !== 'stopped') this.connect();
    }, delay);
  }

  private onMessage(socket: SocketLike, data: unknown): void {
    let msg: Incoming;
    try {
      msg = JSON.parse(String(data)) as Incoming;
    } catch {
      this.send(socket, { jsonrpc: '2.0', id: null, error: { code: JsonRpcErrorCode.PARSE_ERROR, message: 'invalid JSON' } });
      return;
    }
    if (msg.id === HELLO_ID && msg.method === undefined) {
      this.onHelloResponse(socket, msg);
      return;
    }
    if (typeof msg.method === 'string' && msg.id !== undefined) {
      void this.onRequest(socket, msg.id, msg.method, msg.params);
    }
    // Notifications from the host are not used yet.
  }

  private onHelloResponse(socket: SocketLike, msg: Incoming): void {
    if (msg.error !== undefined) {
      this.options.log?.(`hello rejected: ${msg.error.message}`);
      return; // the host closes the socket with a final code
    }
    const result = msg.result as ResultOf<HostMethods['hello']>;
    this._state = 'ready';
    this.attempt = 0;
    this.options.onReady?.(result.config);
    for (const m of this.buffer.splice(0)) socket.send(m);
  }

  private async onRequest(socket: SocketLike, id: string | number, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.options.handle(method, params);
      this.send(socket, { jsonrpc: '2.0', id, result: result ?? null });
    } catch (e) {
      this.send(socket, { jsonrpc: '2.0', id, error: toErrorObject(e) });
    }
  }

  private send(socket: SocketLike, msg: object): void {
    if (this.socket === socket) socket.send(JSON.stringify(msg));
  }
}

export class MethodNotFound extends Error {
  constructor(readonly method: string) {
    super(`unknown method ${method}`);
  }
}

function toErrorObject(e: unknown): JsonRpcFailure['error'] {
  if (e instanceof QuiescoError) return e.toJSON();
  if (e instanceof MethodNotFound) return { code: JsonRpcErrorCode.METHOD_NOT_FOUND, message: e.message };
  const err = e instanceof Error ? e : new Error(String(e));
  return { code: JsonRpcErrorCode.INTERNAL_ERROR, message: `agent error: ${err.message}`, data: { stack: err.stack ?? '' } };
}
