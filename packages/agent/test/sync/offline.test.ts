import { describe, expect, it, vi } from 'vitest';

import { NetworkTracker } from '../../src/sync/network';
import { OFFLINE_HTTP_URL, OFFLINE_WS_URL, OfflineGate, hostOf, ownConnection } from '../../src/sync/offline';

class FakeXhr {
  static opened: string[] = [];
  private listeners: (() => void)[] = [];
  open(_method: string, url: string | URL): void {
    FakeXhr.opened.push(String(url));
  }
  send(): void {}
  addEventListener(_t: string, l: () => void): void {
    this.listeners.push(l);
  }
  finish(): void {
    for (const l of this.listeners) l();
  }
}

class FakeSocket {
  static readonly OPEN = 1;
  constructor(
    readonly url: string,
    readonly protocols?: unknown,
  ) {}
}

function globals() {
  FakeXhr.opened = [];
  const fetch = vi.fn(async (_input: unknown, _init?: unknown) => 'response');
  return { fetch, XMLHttpRequest: FakeXhr, WebSocket: FakeSocket } as unknown as {
    fetch: typeof fetch;
    XMLHttpRequest: typeof FakeXhr;
    WebSocket: typeof FakeSocket;
  };
}

describe('OfflineGate', () => {
  it('leaves everything alone while online', async () => {
    const g = globals();
    const fetch = g.fetch;
    const gate = new OfflineGate(g as never);
    gate.install();
    await g.fetch('https://api.example.com/todos');
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/todos', undefined);
    new g.XMLHttpRequest().open('GET', 'https://api.example.com/x');
    expect(FakeXhr.opened).toEqual(['https://api.example.com/x']);
    expect(new g.WebSocket('wss://chat.example.com', ['v1']).url).toBe('wss://chat.example.com');
  });

  it('sends new connections to an unresolvable host while offline, except exempt URLs', async () => {
    const g = globals();
    const fetch = g.fetch;
    const gate = new OfflineGate(g as never);
    gate.install();
    gate.setExempt(ownConnection(7357));
    gate.setOffline(true);

    await g.fetch('http://localhost:3001/todos', { method: 'PUT' });
    expect(fetch).toHaveBeenLastCalledWith(OFFLINE_HTTP_URL, { method: 'PUT' });
    new g.XMLHttpRequest().open('GET', '/relative');
    const ws = new g.WebSocket('wss://chat.example.com', ['v1']);
    expect(ws.url).toBe(OFFLINE_WS_URL);
    expect(ws.protocols).toEqual(['v1']);
    expect(ws).toBeInstanceOf(FakeSocket);
    expect(g.WebSocket.OPEN).toBe(1);
    expect(g.WebSocket.name).toBe('FakeSocket');

    // The agent's own connection keeps working.
    expect(new g.WebSocket('ws://localhost:7357').url).toBe('ws://localhost:7357');
    expect(new g.WebSocket('ws://127.0.0.1:7357').url).toBe('ws://127.0.0.1:7357');
    expect(FakeXhr.opened).toEqual([OFFLINE_HTTP_URL]);

    gate.setOffline(false);
    await g.fetch('http://localhost:3001/todos');
    expect(fetch).toHaveBeenLastCalledWith('http://localhost:3001/todos', undefined);
  });

  it('keeps a Request object’s method and signal when redirecting it', async () => {
    const g = globals();
    const fetch = g.fetch;
    const gate = new OfflineGate(g as never);
    gate.install();
    gate.setOffline(true);
    const signal = {};
    await g.fetch({ url: 'https://api.example.com/x', method: 'POST', signal });
    expect(fetch).toHaveBeenLastCalledWith(OFFLINE_HTTP_URL, { method: 'POST', signal });
  });

  it('uninstall restores the originals', () => {
    const g = globals();
    const { fetch, WebSocket } = g;
    const open = FakeXhr.prototype.open;
    const gate = new OfflineGate(g as never);
    gate.install();
    gate.uninstall();
    expect(g.fetch).toBe(fetch);
    expect(g.WebSocket).toBe(WebSocket);
    expect(FakeXhr.prototype.open).toBe(open);
  });

  it('under the network tracker: the tracker reports the URL the app asked for', () => {
    const g = globals();
    const gate = new OfflineGate(g as never);
    gate.install();
    const tracker = new NetworkTracker({ target: g as never, now: () => 0 });
    tracker.install();
    gate.setOffline(true);
    const xhr = new g.XMLHttpRequest();
    xhr.open('GET', 'http://localhost:3001/todos');
    xhr.send();
    expect(tracker.describeBusy()).toEqual(['GET http://localhost:3001/todos (0ms)']);
    expect(FakeXhr.opened).toEqual([OFFLINE_HTTP_URL]);
    xhr.finish();
    expect(tracker.isIdle()).toBe(true);
    tracker.uninstall();
    gate.uninstall();
  });
});

describe('hostOf', () => {
  it('reads host:port of absolute URLs', () => {
    expect(hostOf('ws://LOCALHOST:7357/x')).toBe('localhost:7357');
    expect(hostOf('https://user:pw@api.example.com/a?b')).toBe('api.example.com');
    expect(hostOf('/relative')).toBeNull();
  });
});
