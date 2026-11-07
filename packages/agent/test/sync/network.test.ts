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
  open(...args: [method: string, url: string]): void {
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
