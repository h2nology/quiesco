/**
 * In-flight `fetch` / `XMLHttpRequest` tracker (requirements.md §6.2-1). WebSocket is not tracked.
 * On React Native, `fetch` is implemented on top of XHR (whatwg-fetch); XHRs sent synchronously from
 * inside a tracked `fetch()` call are not counted a second time.
 */
import type { IdleTracker } from './tracker';
import { isFunction, patch } from './tracker';

export type UrlPattern = RegExp | string;

interface XhrLike {
  addEventListener(type: string, listener: () => void): void;
}
interface XhrCtor {
  prototype: {
    open: (this: XhrLike, method: string, url: string | URL, ...rest: unknown[]) => unknown;
    send: (this: XhrLike, body?: unknown) => unknown;
  };
}
type FetchFn = (this: unknown, input: unknown, init?: unknown) => Promise<unknown>;

export interface NetworkGlobals {
  fetch?: FetchFn;
  XMLHttpRequest?: XhrCtor;
}

export interface NetworkTrackerOptions {
  target?: NetworkGlobals;
  /** Requests whose URL matches are ignored (long polling, SSE, analytics). Strings match as substrings. */
  ignoreUrls?: readonly UrlPattern[];
  now?: () => number;
}

interface Request {
  method: string;
  url: string;
  since: number;
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (typeof input === 'object' && input !== null) {
    const u = (input as { url?: unknown; href?: unknown }).url ?? (input as { href?: unknown }).href;
    if (typeof u === 'string') return u;
  }
  return String(input);
}

function methodOf(input: unknown, init: unknown): string {
  const m = (init as { method?: unknown } | undefined)?.method ?? (input as { method?: unknown } | null)?.method;
  return typeof m === 'string' ? m.toUpperCase() : 'GET';
}

export class NetworkTracker implements IdleTracker {
  readonly name = 'network';
  private readonly pending = new Map<number, Request>();
  private readonly xhrInfo = new WeakMap<object, { method: string; url: string }>();
  private readonly restores: (() => void)[] = [];
  private nextId = 1;
  private insideFetch = 0;
  private readonly target: NetworkGlobals;
  private readonly now: () => number;

  constructor(private readonly options: NetworkTrackerOptions = {}) {
    this.target = options.target ?? (globalThis as unknown as NetworkGlobals);
    this.now = options.now ?? Date.now;
  }

  isIdle(): boolean {
    return this.pending.size === 0;
  }

  describeBusy(): string[] {
    const t = this.now();
    return [...this.pending.values()].map((r) => `${r.method} ${r.url} (${t - r.since}ms)`);
  }

  install(): void {
    if (this.restores.length > 0) return;
    const self = this;
    if (isFunction(this.target.fetch)) {
      this.restores.push(
        patch(this.target, 'fetch', (original) =>
          function (this: unknown, input: unknown, init?: unknown) {
            const url = urlOf(input);
            if (self.ignored(url)) return (original as FetchFn).call(this, input, init);
            const id = self.begin(methodOf(input, init), url);
            const done = (): void => self.end(id);
            let p: Promise<unknown>;
            self.insideFetch++;
            try {
              p = (original as FetchFn).call(this, input, init);
            } catch (e) {
              done();
              throw e;
            } finally {
              self.insideFetch--;
            }
            p.then(done, done);
            return p;
          } as FetchFn,
        ),
      );
    }
    const proto = this.target.XMLHttpRequest?.prototype;
    if (proto !== undefined) {
      this.restores.push(
        patch(proto, 'open', (original) =>
          function (this: XhrLike, method: string, url: string | URL, ...rest: unknown[]) {
            self.xhrInfo.set(this, { method: String(method).toUpperCase(), url: urlOf(url) });
            return original.call(this, method, url, ...rest);
          },
        ),
        patch(proto, 'send', (original) =>
          function (this: XhrLike, body?: unknown) {
            const info = self.xhrInfo.get(this);
            if (info === undefined || self.insideFetch > 0 || self.ignored(info.url)) return original.call(this, body);
            const id = self.begin(info.method, info.url);
            this.addEventListener('loadend', () => self.end(id));
            try {
              return original.call(this, body);
            } catch (e) {
              self.end(id);
              throw e;
            }
          },
        ),
      );
    }
  }

  uninstall(): void {
    while (this.restores.length > 0) this.restores.pop()?.();
    this.pending.clear();
  }

  private ignored(url: string): boolean {
    for (const p of this.options.ignoreUrls ?? []) {
      if (typeof p === 'string' ? url.includes(p) : ((p.lastIndex = 0), p.test(url))) return true;
    }
    return false;
  }

  private begin(method: string, url: string): number {
    const id = this.nextId++;
    this.pending.set(id, { method, url, since: this.now() });
    return id;
  }

  private end(id: number): void {
    this.pending.delete(id);
  }
}
