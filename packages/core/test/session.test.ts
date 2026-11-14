import { afterEach, describe, expect, it } from 'vitest';

import type { QuiescoConfig } from '../src/config';
import { Session } from '../src/session';
import { connectAgent } from './helpers/fake-agent';
import type { FakeAgent, Handler } from './helpers/fake-agent';
import { FakeProvider } from './helpers/fake-provider';
import { silentLogger } from '../src/logger';

let session: Session | null = null;
afterEach(async () => {
  await session?.dispose();
  session = null;
});

const config = (extra: Partial<QuiescoConfig> = {}): QuiescoConfig => ({
  apps: { android: { package: 'p' } },
  server: { port: 0, host: '127.0.0.1' },
  permissions: ['camera'],
  connectTimeoutMs: 2000,
  ...extra,
});

function agentOnLaunch(handler: Handler = () => ({})) {
  const agents: FakeAgent[] = [];
  const provider = new FakeProvider((p) => agents.push(connectAgent(p.port, { sessionId: null, handler })));
  return { provider, agents };
}

describe('Session', () => {
  it('boots, installs, grants, launches and waits for the agent', async () => {
    const { provider, agents } = agentOnLaunch((m) => (m === 'getTree' ? { root: { type: 'RCTView', children: [] } } : {}));
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    expect(provider.calls).toEqual(['boot', 'install', 'grant:camera', 'launch']);
    expect(agents).toHaveLength(1);
    await expect(session.driver.getTree()).resolves.toEqual({ type: 'RCTView', children: [] });
  });

  it('closes the app before it stops, so the app does not reconnect to a later run', async () => {
    const { provider } = agentOnLaunch();
    const s = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    provider.calls.length = 0;
    await s.dispose();
    expect(provider.calls.filter((c) => c === 'terminate' || c === 'shutdown')).toEqual(['terminate', 'shutdown']);
  });

  it('soft-resets before a scenario, and relaunches for @hard-reset', async () => {
    const { provider, agents } = agentOnLaunch((m) => (m === 'reset' ? { durationMs: 5 } : {}));
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    await session.beforeScenario({ tags: ['@smoke'] });
    expect(agents[0]?.requests.map((r) => r.method)).toEqual(['reset']);
    await session.beforeScenario({ tags: ['@hard-reset'] });
    expect(provider.calls.slice(-2)).toEqual(['terminate', 'launch']);
    expect(agents).toHaveLength(2);
    await session.driver.waitForIdle();
    expect(agents[1]?.requests.map((r) => r.method)).toEqual(['waitForIdle']);
  });

  it('collects evidence best effort', async () => {
    const { provider } = agentOnLaunch((m) => {
      if (m === 'getTree') return { root: null };
      throw { code: -32603, message: 'boom' };
    });
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    const ev = await session.collectEvidence();
    expect(ev.screenshot?.toString()).toBe('png');
    expect(ev.tree).toBeNull();
    expect(ev.errors).toEqual(['idle state: boom']);
  });

  it('explains a connection timeout with checks, provider diagnostics and refused connections', async () => {
    const provider = new FakeProvider((p) => connectAgent(p.port, { sessionId: 'someone-else' }));
    const err = await Session.create({ config: config({ connectTimeoutMs: 300 }), platform: 'android', provider, logger: silentLogger }).catch((e: unknown) => e);
    expect(err).toMatchObject({ errorName: 'CONNECT_TIMEOUT' });
    const msg = (err as Error).message;
    expect(msg).toMatch(/did not connect to ws:\/\/localhost:\d+ within 300ms/);
    expect(msg).toContain('EXPO_PUBLIC_QUIESCO=1');
    expect(msg).toMatch(/fake diagnosis for port \d+/);
    expect(msg).toMatch(/Refused connections:\n {2}- Unknown session "someone-else"/);
    expect(provider.calls).toContain('shutdown'); // cleaned up after the failure
  });

  it('follows the app when it reconnects (web page reload) without failing the next call', async () => {
    const { provider, agents } = agentOnLaunch((m) => (m === 'getTree' ? { root: null } : {}));
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    const port = session.launchParams.port;
    agents[0]!.ws.terminate();
    await agents[0]!.closed;
    connectAgent(port, { sessionId: session.launchParams.sessionId, handler: () => ({ root: { type: 'div', children: [] } }) });
    await expect(session.driver.getTree()).resolves.toEqual({ type: 'div', children: [] });
  });
});
