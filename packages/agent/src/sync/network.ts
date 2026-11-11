/**
 * In-flight network tracker (requirements.md §6.2-1; Phase 6.10 hardening, findings「6.10 网络同步 spike」).
 *
 * - `fetch` (the global one, and `expo/fetch` imported directly through `wrapFetch`, see
 *   src/expo-fetch.js): busy until the response arrives, then — rule A (HU 2026-11-10) — until the body is
 *   read: a body read (`json()` / `text()` / …) started before the next macrotask keeps the request busy
 *   until it settles; a response nobody reads ends there. A body read started later counts again, as its
 *   own entry. `expo/fetch` (the native global fetch since SDK 56) resolves on the headers and streams the
 *   body, so without this the app looked idle while `await res.json()` was still waiting.
 * - `XMLHttpRequest`: until `loadend`. On React Native's whatwg-fetch, XHRs sent synchronously from
 *   inside a tracked `fetch()` call are not counted a second time.
 * - `WebSocket` / `EventSource`: only while connecting (until open, error or close); an open connection is
 *   long-lived and never counts.
 *
 * `ignoreUrls` and the exempt predicate (the agent's own connection) apply to all of them.
 */
import type { IdleTracker } from './tracker';
import { isFunction, patch, realClock } from './tracker';

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
export type FetchFn = (this: unknown, input: unknown, init?: unknown) => Promise<unknown>;
type SocketCtor = new (url: string | URL, ...rest: unknown[]) => { addEventListener(type: string, l: () => void): void };

export interface NetworkGlobals {
  fetch?: FetchFn;
  XMLHttpRequest?: XhrCtor;
  WebSocket?: SocketCtor;
  EventSource?: SocketCtor;
}

export interface NetworkTrackerOptions {
  target?: NetworkGlobals;
  /** Requests whose URL matches are ignored (long polling, SSE, analytics). Strings match as substrings. */
  ignoreUrls?: readonly UrlPattern[];
  now?: () => number;
  /** Runs `cb` on the next macrotask with an untracked timer (rule A's window for starting a body read). */
  defer?: (cb: () => void) => void;
}

interface Request {
  method: string;
  url: string;
  since: number;
}

/** Response methods that read the body. */
const BODY_READERS = ['json', 'text', 'arrayBuffer', 'blob', 'bytes', 'formData'] as const;
const PATCHED = Symbol.for('quiesco.trackedResponse');

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
  private readonly defer: (cb: () => void) => void;
  private ignoreUrls: readonly UrlPattern[];
  private exempt: (url: string) => boolean = () => false;

  constructor(options: NetworkTrackerOptions = {}) {
    this.target = options.target ?? (globalThis as unknown as NetworkGlobals);
    this.now = options.now ?? Date.now;
    this.defer = options.defer ?? ((cb) => void realClock.setTimeout(cb, 0));
    this.ignoreUrls = options.ignoreUrls ?? [];
  }

  /** Applies to requests started from now on. */
  setIgnoreUrls(patterns: readonly UrlPattern[]): void {
    this.ignoreUrls = patterns;
  }

  /** Connections never tracked (the agent's own WebSocket). */
  setExempt(exempt: (url: string) => boolean): void {
    this.exempt = exempt;
  }

  isIdle(): boolean {
    return this.pending.size === 0;
  }

  describeBusy(): string[] {
    const t = this.now();
    return [...this.pending.values()].map((r) => `${r.method} ${r.url} (${t - r.since}ms)`);
  }

  /** A fetch function that is tracked like the global one (used for `expo/fetch` imported directly). */
  wrapFetch(original: FetchFn): FetchFn {
    const self = this;
    return function (this: unknown, input: unknown, init?: unknown) {
      const url = urlOf(input);
      if (self.ignored(url)) return original.call(this, input, init);
      const method = methodOf(input, init);
      const id = self.begin(method, url);
      let p: Promise<unknown>;
      self.insideFetch++;
      try {
        p = original.call(this, input, init);
      } catch (e) {
        self.end(id);
        throw e;
      } finally {
        self.insideFetch--;
      }
      // Registered before the caller's handlers, so the response is wrapped before the app sees it.
      p.then(
        (res) => self.awaitBody(id, method, url, res),
        () => self.end(id),
      );
      return p;
    } as FetchFn;
  }

  install(): void {
    if (this.restores.length > 0) return;
    const self = this;
    if (isFunction(this.target.fetch)) {
      this.restores.push(patch(this.target, 'fetch', (original) => this.wrapFetch(original as FetchFn)));
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
    this.trackConnecting('WebSocket', 'WS');
    this.trackConnecting('EventSource', 'SSE');
  }

  uninstall(): void {
    while (this.restores.length > 0) this.restores.pop()?.();
    this.pending.clear();
  }

  /**
   * A subclass that counts the connection until it opens, fails or closes. Subclassing keeps
   * `instanceof`, the static constants and the app's own handlers.
   */
  private trackConnecting(key: 'WebSocket' | 'EventSource', label: string): void {
    const Base = this.target[key];
    if (!isFunction(Base)) return;
    const self = this;
    const Tracked = class extends Base {
      constructor(url: string | URL, ...rest: unknown[]) {
        super(url, ...rest);
        const u = urlOf(url);
        if (self.ignored(u)) return;
        const id = self.begin(label, u);
        const done = (): void => self.end(id);
        try {
          for (const type of ['open', 'error', 'close']) this.addEventListener(type, done);
        } catch {
          done(); // no event API: never leave the app busy
        }
      }
    };
    Object.defineProperty(Tracked, 'name', { value: Base.name });
    this.restores.push(patch(this.target, key, () => Tracked as SocketCtor));
  }

  /**
   * Rule A: keep the request busy until the next macrotask; a body read started by then keeps it busy
   * until the read settles. Reads started later are tracked on their own.
   */
  private awaitBody(id: number, method: string, url: string, res: unknown): void {
    let reading = false;
    const patched = this.wrapBody(res, method, url, () => {
      if (reading || !this.pending.has(id)) return null;
      reading = true;
      return id;
    });
    if (!patched) {
      this.end(id);
      return;
    }
    this.defer(() => {
      if (!reading) this.end(id);
    });
  }

  /**
   * Wraps the body readers of a response (and of its clones). `claim()` returns the pending request id
   * the read continues, or null to track the read as a new entry. False when nothing could be wrapped.
   */
  private wrapBody(res: unknown, method: string, url: string, claim: () => number | null): boolean {
    if (typeof res !== 'object' || res === null) return false;
    const r = res as Record<string | symbol, unknown>;
    if (r[PATCHED] === true) return true;
    const self = this;
    let wrapped = false;
    // whatwg-fetch's json() calls this.text(): a read made from inside another one is the same read.
    let inside = 0;
    try {
      for (const m of BODY_READERS) {
        const read = r[m];
        if (!isFunction(read)) continue;
        r[m] = function (this: unknown, ...args: unknown[]) {
          if (inside > 0) return (read as (...a: unknown[]) => unknown).apply(this, args);
          const id = claim() ?? self.begin(method, `${url} (body)`);
          let p: unknown;
          inside++;
          try {
            p = (read as (...a: unknown[]) => unknown).apply(this, args);
          } catch (e) {
            self.end(id);
            throw e;
          } finally {
            inside--;
          }
          if (p instanceof Promise || (typeof p === 'object' && p !== null && isFunction((p as { then?: unknown }).then))) {
            (p as Promise<unknown>).then(
              () => self.end(id),
              () => self.end(id),
            );
          } else {
            self.end(id);
          }
          return p;
        };
        wrapped = true;
      }
      const clone = r['clone'];
      if (isFunction(clone)) {
        r['clone'] = function (this: unknown, ...args: unknown[]) {
          const c = (clone as (...a: unknown[]) => unknown).apply(this, args);
          self.wrapBody(c, method, url, () => null);
          return c;
        };
      }
      Object.defineProperty(r, PATCHED, { value: true });
    } catch {
      // Frozen or exotic response: fall back to ending at the headers.
    }
    return wrapped;
  }

  private ignored(url: string): boolean {
    if (this.exempt(url)) return true;
    for (const p of this.ignoreUrls) {
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
