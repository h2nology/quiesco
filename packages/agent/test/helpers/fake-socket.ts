import type { SocketLike } from '../../src/platform';

export class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = [];
  closed: { code: number | undefined; reason: string | undefined } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  /** Host side helpers. */
  open(): void {
    this.onopen?.();
  }
  receive(msg: object | string): void {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  }
  drop(code = 1006, reason = ''): void {
    this.onclose?.({ code, reason });
  }
}

export const CONFIG = {
  sync: { timeoutMs: 1000, timerThresholdMs: 1500, countIntervals: false, stableFrames: 2, ignoreUrls: [], trackers: {} },
  logLevel: 'warn' as const,
};

/** Complete the hello handshake on `s`. */
export function acceptHello(s: FakeSocket, config = CONFIG): void {
  s.open();
  s.receive({ jsonrpc: '2.0', id: 'hello', result: { accepted: true, sessionId: 'sess', config } });
}
