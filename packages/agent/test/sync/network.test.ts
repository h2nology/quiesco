import { describe, expect, it } from 'vitest';

import { NetworkTracker } from '../../src/sync';

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeXHR {
  static sent: FakeXHR[] = [];
  private listeners: (() => void)[] = [];
  open(...args: [method: string, url: string | URL]): void {
    void args;
  }
  send(): void {
    FakeXHR.sent.push(this);
  }
  addEventListener(type: string, l: () => void): void {
    if (type === 'loadend') this.listeners.push(l);
  }
  finish(): void {
    this.listeners.forEach((l) => l());
  }
}

type Deferred = ReturnType<typeof deferred>;

const flush = () => new Promise((r) => setImmediate(r));

function setup(ignoreUrls: (RegExp | string)[] = []) {
  let now = 1000;
  const calls: Deferred[] = [];
  const target = {
    fetch: (() => {
      const d = deferred();
      calls.push(d);
      return d.promise;
    }) as (input: unknown, init?: unknown) => Promise<unknown>,
    XMLHttpRequest: FakeXHR,
  };
  const t = new NetworkTracker({ target, ignoreUrls, now: () => now });
  t.install();
  return { t, target, calls, tick: (ms: number) => (now += ms) };
}

describe('NetworkTracker', () => {
  it('tracks fetch until it settles (resolve or reject)', async () => {
    const { t, target, calls, tick } = setup();
    void target.fetch('https://api.test/todos');
    const p2 = target.fetch({ url: 'https://api.test/x', method: 'post' });
    p2.catch(() => {});
    tick(1200);
    expect(t.isIdle()).toBe(false);
    expect(t.describeBusy()).toEqual(['GET https://api.test/todos (1200ms)', 'POST https://api.test/x (1200ms)']);
    calls[0]!.resolve('ok');
    calls[1]!.reject(new Error('net'));
    await flush();
    expect(t.isIdle()).toBe(true);
  });

  it('tracks XHR until loadend', () => {
    const { t, target } = setup();
    const xhr = new target.XMLHttpRequest();
    xhr.open('get', 'https://api.test/a');
    xhr.send();
    expect(t.describeBusy()).toEqual(['GET https://api.test/a (0ms)']);
    xhr.finish();
    expect(t.isIdle()).toBe(true);
  });

  it('does not double count the XHR that fetch uses internally (RN whatwg-fetch)', async () => {
    let inner: FakeXHR | null = null;
    const target = {
      fetch: (url: unknown) => {
        const x = new FakeXHR();
        x.open('GET', String(url));
        x.send();
        inner = x;
        return Promise.resolve('ok');
      },
      XMLHttpRequest: FakeXHR,
    };
    const t = new NetworkTracker({ target });
    t.install();
    const p = target.fetch('https://api.test/a');
    expect(t.describeBusy()).toHaveLength(1);
    await p;
    await flush();
    inner!.finish();
    expect(t.isIdle()).toBe(true);
  });

  it('ignores URLs by regex or substring', () => {
    const { t, target } = setup([/\/analytics\//, 'sse']);
    void target.fetch('https://x.test/analytics/event');
    void target.fetch('https://x.test/sse/stream');
    expect(t.isIdle()).toBe(true);
  });

  it('cleans up when fetch throws synchronously, and restores globals on uninstall', () => {
    const throwing = () => {
      throw new TypeError('bad');
    };
    const target = { fetch: throwing as unknown as (i: unknown) => Promise<unknown> };
    const t = new NetworkTracker({ target });
    t.install();
    expect(() => target.fetch('x')).toThrow('bad');
    expect(t.isIdle()).toBe(true);
    t.uninstall();
    expect(target.fetch).toBe(throwing);
  });
});

/** Manual macrotask queue for rule A's window. */
function manualDefer() {
  const queue: (() => void)[] = [];
  return { defer: (cb: () => void) => void queue.push(cb), run: () => queue.splice(0).forEach((cb) => cb()) };
}

class FakeResponse {
  readonly reads: ReturnType<typeof deferred>[] = [];
  json(): Promise<unknown> {
    const d = deferred();
    this.reads.push(d);
    return d.promise;
  }
  text(): Promise<unknown> {
    return this.json();
  }
  clone(): FakeResponse {
    return new FakeResponse();
  }
}

function setupBody() {
  const m = manualDefer();
  const calls: Deferred[] = [];
  const target = {
    fetch: (() => {
      const d = deferred();
      calls.push(d);
      return d.promise;
    }) as (input: unknown, init?: unknown) => Promise<unknown>,
  };
  const t = new NetworkTracker({ target, now: () => 0, defer: m.defer });
  t.install();
  return { t, target, calls, run: m.run };
}

describe('NetworkTracker: response body (rule A)', () => {
  it('keeps the request busy while a body read started right away is pending', async () => {
    const { t, target, calls, run } = setupBody();
    const res = new FakeResponse();
    const body = target.fetch('https://api.test/todos').then((r) => (r as FakeResponse).json());
    calls[0]!.resolve(res);
    await flush();
    run();
    expect(t.describeBusy()).toEqual(['GET https://api.test/todos (0ms)']);
    res.reads[0]!.resolve({ ok: true });
    await body;
    await flush();
    expect(t.isIdle()).toBe(true);
  });

  it('ends at the next macrotask when nobody reads the body', async () => {
    const { t, target, calls, run } = setupBody();
    void target.fetch('https://api.test/ping');
    calls[0]!.resolve(new FakeResponse());
    await flush();
    expect(t.isIdle()).toBe(false);
    run();
    expect(t.isIdle()).toBe(true);
  });

  it('tracks a later body read as its own entry, until it settles or fails', async () => {
    const { t, target, calls, run } = setupBody();
    const res = new FakeResponse();
    const p = target.fetch('https://api.test/a');
    calls[0]!.resolve(res);
    await p;
    run();
    expect(t.isIdle()).toBe(true);
    const read = res.text();
    expect(t.describeBusy()).toEqual(['GET https://api.test/a (body) (0ms)']);
    res.reads[0]!.reject(new Error('aborted'));
    await read.catch(() => undefined);
    await flush();
    expect(t.isIdle()).toBe(true);
  });

  it('tracks reads of a clone', async () => {
    const { t, target, calls, run } = setupBody();
    const res = new FakeResponse();
    const p = target.fetch('https://api.test/c');
    calls[0]!.resolve(res);
    await p;
    run();
    const copy = res.clone();
    const read = copy.json();
    expect(t.isIdle()).toBe(false);
    copy.reads[0]!.resolve(1);
    await read;
    await flush();
    expect(t.isIdle()).toBe(true);
  });

  it('ends at once for a response without body readers, and on a rejected fetch', async () => {
    const { t, target, calls } = setupBody();
    void target.fetch('https://api.test/x');
    const failed = target.fetch('https://api.test/y');
    failed.catch(() => undefined);
    calls[0]!.resolve(Object.freeze({ status: 204 }));
    calls[1]!.reject(new TypeError('Network request failed'));
    await flush();
    expect(t.isIdle()).toBe(true);
  });

  it('wrapFetch tracks another fetch function (expo/fetch imported directly)', async () => {
    const m = manualDefer();
    const t = new NetworkTracker({ target: {}, now: () => 0, defer: m.defer });
    const d = deferred();
    const tracked = t.wrapFetch(() => d.promise);
    void tracked('https://api.test/direct', { method: 'put' });
    expect(t.describeBusy()).toEqual(['PUT https://api.test/direct (0ms)']);
    d.resolve(new FakeResponse());
    await flush();
    m.run();
    expect(t.isIdle()).toBe(true);
  });
});

class FakeSocket {
  static readonly OPEN = 1;
  private readonly listeners = new Map<string, (() => void)[]>();
  constructor(readonly url: string | URL) {}
  addEventListener(type: string, l: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  emit(type: string): void {
    (this.listeners.get(type) ?? []).forEach((l) => l());
  }
}

describe('NetworkTracker: WebSocket / EventSource', () => {
  function setupSockets(ignoreUrls: (RegExp | string)[] = []) {
    const target = { WebSocket: FakeSocket as unknown as new (url: string | URL) => FakeSocket, EventSource: class extends FakeSocket {} as unknown as new (url: string | URL) => FakeSocket };
    const t = new NetworkTracker({ target, ignoreUrls, now: () => 0 });
    t.install();
    return { t, target };
  }

  it('counts a WebSocket only while connecting (open, error or close end it)', () => {
    const { t, target } = setupSockets();
    const a = new target.WebSocket('wss://chat.test/a');
    const b = new target.WebSocket('wss://chat.test/b');
    const c = new target.WebSocket('wss://chat.test/c');
    expect(t.describeBusy()).toEqual(['WS wss://chat.test/a (0ms)', 'WS wss://chat.test/b (0ms)', 'WS wss://chat.test/c (0ms)']);
    a.emit('open');
    b.emit('error');
    c.emit('close');
    expect(t.isIdle()).toBe(true);
    a.emit('close');
    expect(t.isIdle()).toBe(true);
  });

  it('keeps instanceof, the statics and the name', () => {
    const { target } = setupSockets();
    const s = new target.WebSocket('wss://x.test');
    expect(s).toBeInstanceOf(FakeSocket);
    expect((target.WebSocket as unknown as typeof FakeSocket).OPEN).toBe(1);
    expect(target.WebSocket.name).toBe('FakeSocket');
  });

  it('counts an EventSource until it opens', () => {
    const { t, target } = setupSockets();
    const es = new target.EventSource('https://api.test/stream');
    expect(t.describeBusy()).toEqual(['SSE https://api.test/stream (0ms)']);
    es.emit('open');
    expect(t.isIdle()).toBe(true);
  });

  it('skips ignored URLs and the exempt (agent) connection, and restores the globals', () => {
    const { t, target } = setupSockets(['/poll']);
    t.setExempt((u) => u.startsWith('ws://localhost:8099'));
    new target.WebSocket('ws://localhost:8099');
    new target.WebSocket('wss://x.test/poll');
    expect(t.isIdle()).toBe(true);
    t.uninstall();
    expect(target.WebSocket).toBe(FakeSocket);
  });
});
