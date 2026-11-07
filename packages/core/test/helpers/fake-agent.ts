/** A protocol-speaking stand-in for @quiesco/agent, over a real WebSocket. */
import { PROTOCOL_VERSION } from '@quiesco/protocol';
import type { AgentConfig } from '@quiesco/protocol';
import WebSocket from 'ws';

export type Handler = (method: string, params: Record<string, unknown>) => unknown;

export interface FakeAgent {
  ws: WebSocket;
  /** hello result, or the error the host replied with. */
  hello: Promise<{ result?: { sessionId: string; config: AgentConfig }; error?: { code: number; message: string; data?: Record<string, unknown> } }>;
  closed: Promise<{ code: number; reason: string }>;
  requests: { method: string; params: Record<string, unknown> }[];
  notify(method: 'log' | 'error', params: Record<string, unknown>): void;
}

export function connectAgent(
  port: number,
  opts: { sessionId?: string | null; protocolVersion?: number; nativeModule?: boolean; handler?: Handler } = {},
): FakeAgent {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const requests: FakeAgent['requests'] = [];
  let resolveHello!: (v: Awaited<FakeAgent['hello']>) => void;
  const hello = new Promise<Awaited<FakeAgent['hello']>>((r) => (resolveHello = r));
  const closed = new Promise<{ code: number; reason: string }>((r) => ws.on('close', (code, reason) => r({ code, reason: reason.toString() })));
  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'hello',
        method: 'hello',
        params: {
          sessionId: opts.sessionId === undefined ? null : opts.sessionId,
          platform: 'android',
          protocolVersion: opts.protocolVersion ?? PROTOCOL_VERSION,
          agentVersion: '0.0.0',
          nativeModule: opts.nativeModule ?? false,
        },
      }),
    );
  });
  ws.on('message', async (data) => {
    const msg = JSON.parse(String(data)) as { id?: unknown; method?: string; params?: Record<string, unknown>; result?: never; error?: never };
    if (msg.id === 'hello') {
      resolveHello({ result: msg.result, error: msg.error });
      return;
    }
    if (typeof msg.method !== 'string') return;
    requests.push({ method: msg.method, params: msg.params ?? {} });
    try {
      const result = await (opts.handler ?? (() => ({})))(msg.method, msg.params ?? {});
      if (result === NO_REPLY) return;
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: result ?? null }));
    } catch (e) {
      const err = e as { code?: number; message: string; data?: unknown };
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: err.code ?? -32603, message: err.message, data: err.data } }));
    }
  });
  return {
    ws,
    hello,
    closed,
    requests,
    notify: (method, params) => ws.send(JSON.stringify({ jsonrpc: '2.0', method, params })),
  };
}

/** Return this from a handler to never answer (simulates a blocked JS thread). */
export const NO_REPLY = Symbol('no-reply');

export const AGENT_CONFIG: AgentConfig = {
  sync: { timeoutMs: 1000, timerThresholdMs: 1500, countIntervals: false, stableFrames: 2, ignoreUrls: [], trackers: {} },
  logLevel: 'warn',
};
