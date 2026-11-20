import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { QuiescoConfig } from '../src/config';
import { NATIVE_MODULES_NOT_WRAPPED, Session } from '../src/session';
import { NO_REPLY, connectAgent } from './helpers/fake-agent';
import type { FakeAgent, Handler } from './helpers/fake-agent';
import { FakeProvider } from './helpers/fake-provider';
import { silentLogger } from '../src/logger';
import type { CrashReport } from '../src/devices/crash';
import type { LaunchParams } from '../src/devices/provider';

/** A device whose app can crash: the process is gone and the device kept a report (issue #76). */
class CrashingProvider extends FakeProvider {
  alive = true;
  reportSince: number | null = null;
  constructor(onLaunch: (p: LaunchParams) => void, private readonly report: CrashReport | null) {
    super(onLaunch);
  }
  override async launch(p: LaunchParams) {
    this.alive = true;
    await super.launch(p);
  }
  async isAppRunning() {
    return this.alive;
  }
  async crashReport(sinceMs: number) {
    this.reportSince = sinceMs;
    return this.report;
  }
}

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

  it('warns once when the config turns the native-module tracker on but the build does not wrap native modules (#74)', async () => {
    const run = async (hello: Record<string, unknown>, on: boolean) => {
      const warnings: string[] = [];
      const provider = new FakeProvider((p) => void connectAgent(p.port, { sessionId: null, hello }));
      const s = await Session.create({ config: config(on ? { sync: { trackers: { 'native-module': true } } } : {}), platform: 'android', provider, logger: { ...silentLogger, warn: (m) => warnings.push(m) } });
      await s.dispose();
      return warnings.filter((w) => w === NATIVE_MODULES_NOT_WRAPPED).length;
    };
    expect(await run({ nativeModulesWrapped: false }, true)).toBe(1);
    expect(await run({ nativeModulesWrapped: true }, true)).toBe(0);
    expect(await run({ nativeModulesWrapped: false }, false)).toBe(0);
    expect(await run({}, true)).toBe(0); // an older agent does not say
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
      if (m === 'listElements') return { route: '/students/new', elements: [{ type: 'RCTView', testID: 'search', visible: false, hidden: 'it is on a screen that is not on top (another screen covers it)' }], truncated: false };
      throw { code: -32603, message: 'boom' };
    });
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    const ev = await session.collectEvidence();
    expect(ev.screenshot?.toString()).toBe('png');
    expect(ev.tree).toBeNull();
    expect(ev.elements?.route).toBe('/students/new');
    expect(ev.errors).toEqual(['idle state: boom']);
  });

  it("attaches the scenario's console.errors to a failed scenario, and forgets them at the next one (issue #31)", async () => {
    const { provider, agents } = agentOnLaunch((m) => (m === 'getTree' ? { root: null } : m === 'listElements' ? { route: null, elements: [], truncated: false } : {}));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-artifacts-'));
    session = await Session.create({ config: config({ artifacts: { dir } }), platform: 'android', provider, logger: silentLogger });
    await session.startScenario({ name: 'logs in' });
    agents[0]!.notify('log', { level: 'error', message: "The screen 'login' was removed natively", timestamp: 1 });
    await expect.poll(() => session!.driver.appLogErrors.length).toBe(1);
    const failed = await session.afterScenario({ failed: true });
    const file = failed.attachments.find((a) => a.fileName === 'app-errors.txt');
    expect(file?.data.toString()).toBe("The screen 'login' was removed natively\n");
    await session.startScenario({ name: 'next' });
    expect(session.driver.appLogErrors).toEqual([]);
    const passed = await session.afterScenario({ failed: false });
    expect(passed.attachments.find((a) => a.fileName === 'app-errors.txt')).toBeUndefined();
  });

  it('an agent without listElements (older than the host) is not an evidence error', async () => {
    const { provider } = agentOnLaunch((m) => {
      if (m === 'listElements') throw { code: -32601, message: 'unknown method listElements' };
      if (m === 'getTree') return { root: null };
      return { trackers: [] };
    });
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    const ev = await session.collectEvidence();
    expect(ev.elements).toBeUndefined();
    expect(ev.errors).toEqual([]);
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

  describe('when the app crashes (#76, #77)', () => {
    const tap = { action: { type: 'tap', matcher: { id: 'row' } }, mode: 'js' } as const;
    function crashing(report: CrashReport | null) {
      const agents: FakeAgent[] = [];
      const provider: CrashingProvider = new CrashingProvider(
        (p) => agents.push(connectAgent(p.port, { sessionId: null, handler: (m) => (m === 'action' ? NO_REPLY : m === 'getTree' ? { root: null } : m === 'reset' ? { durationMs: 1 } : {}) })),
        report,
      );
      return { provider, agents };
    }
    /** The app dies while handling a tap. */
    async function crashDuringTap(provider: CrashingProvider, agents: FakeAgent[]) {
      const call = session!.driver.request('action', tap);
      call.catch(() => undefined);
      await expect.poll(() => agents[0]!.requests.some((r) => r.method === 'action')).toBe(true);
      provider.alive = false;
      agents[0]!.ws.terminate();
      return call.then(() => null, (e: unknown) => e as { errorName: string; message: string; data: Record<string, unknown> });
    }

    it('fails the call with APP_CRASHED and the crash\'s reason, without waiting for the app to reconnect', async () => {
      const { provider, agents } = crashing({ summary: 'FATAL EXCEPTION: main\nProcess: p, PID: 1\njava.lang.RuntimeException: boom', file: '/tmp/x.ips' });
      session = await Session.create({ config: config({ connectTimeoutMs: 60_000 }), platform: 'android', provider, logger: silentLogger, crashPollMs: 10 });
      const started = Date.now();
      const e = await crashDuringTap(provider, agents);
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(e?.errorName).toBe('APP_CRASHED');
      expect(e?.message).toBe('The app crashed while handling action:\n  FATAL EXCEPTION: main\n  Process: p, PID: 1\n  java.lang.RuntimeException: boom\nCrash report: /tmp/x.ips');
      expect(e?.data).toMatchObject({ method: 'action', report: '/tmp/x.ips' });
      expect(provider.reportSince).toBeGreaterThan(0);
      // Later calls fail at once with the same error, until the app is started again.
      await expect(session!.driver.getTree()).rejects.toMatchObject({ errorName: 'APP_CRASHED' });
    });

    it('evidence leaves out what needs the app and keeps the crash; the next scenario starts the app at once', async () => {
      const { provider, agents } = crashing(null);
      session = await Session.create({ config: config({ connectTimeoutMs: 60_000 }), platform: 'android', provider, logger: silentLogger, crashPollMs: 10 });
      const e = await crashDuringTap(provider, agents);
      expect(e?.message).toBe('The app crashed while handling action: its process is gone (the device kept no crash report)');
      const ev = await session!.collectEvidence();
      expect(ev).toMatchObject({ screenshot: Buffer.from('png'), errors: [], crash: { errorName: 'APP_CRASHED' } });
      expect(ev.tree).toBeUndefined();
      expect(agents[0]!.requests.map((r) => r.method)).toEqual(['action']);
      provider.calls.length = 0;
      const started = Date.now();
      await session!.beforeScenario({});
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(provider.calls).toEqual(['terminate', 'launch']);
      expect(agents[1]!.requests.map((r) => r.method)).toEqual(['reset']);
      await expect(session!.driver.getTree()).resolves.toBeNull();
    });

    it('a dropped connection of a live app stays AGENT_DISCONNECTED', async () => {
      const { provider, agents } = crashing(null);
      session = await Session.create({ config: config({ connectTimeoutMs: 60_000 }), platform: 'android', provider, logger: silentLogger, crashPollMs: 10 });
      const call = session.driver.request('action', tap);
      call.catch(() => undefined);
      await expect.poll(() => agents[0]!.requests.some((r) => r.method === 'action')).toBe(true);
      agents[0]!.ws.terminate();
      await agents[0]!.closed;
      connectAgent(session.launchParams.port, { sessionId: session.launchParams.sessionId, handler: () => ({ root: null }) });
      await expect(call).rejects.toMatchObject({ errorName: 'AGENT_DISCONNECTED' });
      await expect(session.driver.getTree()).resolves.toBeNull();
    });
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
