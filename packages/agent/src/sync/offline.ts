/**
 * Simulated offline mode (Phase 6.6 `app.device.setNetwork('offline')`; HU 2026-11-09: the agent blocks the
 * app's connections on every platform, Android / the web also cut the device's network). While offline,
 * the app's new fetch / XMLHttpRequest / WebSocket connections are sent to a host that never resolves
 * (`.invalid`, RFC 6761), so they fail the way that platform fails without a network — React Native's
 * "Network request failed", a browser's "Failed to fetch", a WebSocket error and close — instead of with
 * made-up errors. Connections already open stay open. The agent's own connection is exempt.
 *
 * Installed before the network tracker, which wraps these patches and so still reports (and waits for)
 * the URL the app asked for.
 */
import { isFunction, patch } from './tracker';

/** Where blocked requests go: a name no resolver answers (RFC 6761 `.invalid`). */
export const OFFLINE_HTTP_URL = 'http://offline.quiesco.invalid/';
export const OFFLINE_WS_URL = 'ws://offline.quiesco.invalid/';

type FetchFn = (this: unknown, input: unknown, init?: unknown) => Promise<unknown>;
type OpenFn = (this: unknown, method: string, url: string | URL, ...rest: unknown[]) => unknown;
type SocketCtor = new (url: string | URL, ...rest: unknown[]) => object;

export interface OfflineGlobals {
  fetch?: FetchFn;
  XMLHttpRequest?: { prototype: { open: OpenFn } };
  WebSocket?: SocketCtor;
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (typeof input === 'object' && input !== null) {
    const u = (input as { url?: unknown; href?: unknown }).url ?? (input as { href?: unknown }).href;
    if (typeof u === 'string') return u;
  }
  return String(input);
}

/** `host:port` of an absolute URL (lower case, default ports left out as written), else null. */
export function hostOf(url: string): string | null {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]+)/i.exec(url);
  return m === null ? null : (m[1] as string).toLowerCase();
}

/** Exempts the agent's own connection, `ws://localhost:<port>` (also reached as 127.0.0.1). */
export function ownConnection(port: number | string): (url: string) => boolean {
  const own = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  return (url) => {
    const h = hostOf(url);
    return h !== null && own.has(h);
  };
}

export class OfflineGate {
  private offline = false;
  private exempt: (url: string) => boolean = () => false;
  private readonly restores: (() => void)[] = [];

  constructor(private readonly target: OfflineGlobals = globalThis as unknown as OfflineGlobals) {}

  get isOffline(): boolean {
    return this.offline;
  }

  /** Applies to connections opened from now on. */
  setOffline(offline: boolean): void {
    this.offline = offline;
  }

  /** URLs that keep working offline (the agent's own connection). */
  setExempt(exempt: (url: string) => boolean): void {
    this.exempt = exempt;
  }

  blocks(url: string): boolean {
    return this.offline && !this.exempt(url);
  }

  install(): void {
    if (this.restores.length > 0) return;
    const self = this;
    if (isFunction(this.target.fetch)) {
      this.restores.push(
        patch(this.target, 'fetch', (original) =>
          function (this: unknown, input: unknown, init?: unknown) {
            if (!self.blocks(urlOf(input))) return (original as FetchFn).call(this, input, init);
            // A Request object carries its method and signal; its body is irrelevant, the request fails.
            const req = typeof input === 'object' && input !== null && typeof (input as { url?: unknown }).url === 'string' ? (input as { method?: unknown; signal?: unknown }) : null;
            const merged = req === null ? init : { method: req.method, ...(req.signal !== undefined ? { signal: req.signal } : {}), ...(init as object | undefined) };
            return (original as FetchFn).call(this, OFFLINE_HTTP_URL, merged);
          } as FetchFn,
        ),
      );
    }
    const proto = this.target.XMLHttpRequest?.prototype;
    if (proto !== undefined && isFunction(proto.open)) {
      this.restores.push(
        patch(proto, 'open', (original) =>
          function (this: unknown, method: string, url: string | URL, ...rest: unknown[]) {
            return original.call(this, method, self.blocks(urlOf(url)) ? OFFLINE_HTTP_URL : url, ...rest);
          },
        ),
      );
    }
    const WS = this.target.WebSocket;
    if (isFunction(WS)) {
      // A subclass keeps `instanceof WebSocket`, the static constants and the app's event handlers.
      const Offline = class extends WS {
        constructor(url: string | URL, ...rest: unknown[]) {
          super(self.blocks(urlOf(url)) ? OFFLINE_WS_URL : url, ...rest);
        }
      };
      Object.defineProperty(Offline, 'name', { value: WS.name });
      this.restores.push(patch(this.target, 'WebSocket', () => Offline as SocketCtor));
    }
  }

  uninstall(): void {
    while (this.restores.length > 0) this.restores.pop()?.();
  }
}
