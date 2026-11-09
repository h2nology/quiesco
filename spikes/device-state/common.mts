// Phase 6.6 spike helpers: a session on the example app and a probe that survives reconnects.
import { Session } from '@quiesco/core';
import type { Platform } from '@quiesco/protocol';

export const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);
export const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)); // spike only

export async function open(platform: Platform): Promise<Session> {
  const metroUrl = process.env['QUIESCO_METRO_URL'] ?? 'http://localhost:8083';
  const apps = platform === 'ios'
    ? { ios: { bundleId: 'dev.quiesco.todo', devClient: { metroUrl } } }
    : { android: { package: 'dev.quiesco.todo', devClient: { scheme: 'quiescotodo', metroUrl }, reversePorts: [3001] } };
  return Session.create({ platform, config: { apps, devices: { [platform]: {} }, logLevel: 'warn', connectTimeoutMs: 60_000 } as never });
}

export type Probe = { context: string; window: string; scheme: string | null; fontScale: number; locale: string; netinfo: boolean; events: string[] };

/** Call a backdoor, retrying while the app reconnects (JS reload / restart). */
export async function call<T>(s: Session, name: string, ...args: never[]): Promise<T | string> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return (await s.driver.backdoor(name, ...args)) as T;
    } catch (e) {
      const n = (e as { errorName?: string }).errorName;
      if (Date.now() > deadline || (n !== 'AGENT_DISCONNECTED' && n !== 'CONNECT_TIMEOUT' && n !== 'AGENT_TIMEOUT')) return `${n}: ${(e as Error).message}`;
    }
  }
}

/** Probe until `ok` holds (or 8 s), printing what changed. */
export async function probeUntil(s: Session, label: string, ok: (p: Probe) => boolean): Promise<Probe | string> {
  const deadline = Date.now() + 8_000;
  const events: string[] = [];
  for (;;) {
    const p = await call<Probe>(s, 'spikeProbe');
    if (typeof p === 'string') {
      log(label, 'probe failed:', p);
      return p;
    }
    events.push(...p.events);
    if (ok(p) || Date.now() > deadline) {
      log(label, ok(p) ? 'OK' : 'NOT REACHED', JSON.stringify({ ...p, events }));
      return p;
    }
    await pause(250);
  }
}
