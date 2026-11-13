import { deflateSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import type { QuiescoConfig } from '../src/config';
import type { InAppControls, LaunchParams } from '../src/devices/provider';
import { encodeLaunchArgs, checkLaunchArgs } from '../src/launch-args';
import { silentLogger } from '../src/logger';
import { cropPng, decodePng, encodePng, pngSize } from '../src/png';
import { Driver } from '../src/driver';
import { Session } from '../src/session';
import { NO_REPLY, connectAgent } from './helpers/fake-agent';
import type { FakeAgent } from './helpers/fake-agent';
import { FakeProvider } from './helpers/fake-provider';

// ---------------------------------------------------------------- PNG

/** A w×h RGBA image whose pixel (x, y) is [x, y, 7, 255]. */
function gradient(w: number, h: number) {
  const pixels = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels.set([x, y, 7, 255], (y * w + x) * 4);
  return { width: w, height: h, channels: 4 as const, pixels };
}

describe('png', () => {
  it('round-trips and crops (clamped to the image)', () => {
    const png = encodePng(gradient(20, 10));
    expect(pngSize(png)).toEqual({ width: 20, height: 10 });
    expect(decodePng(png).pixels.equals(gradient(20, 10).pixels)).toBe(true);
    const cut = decodePng(cropPng(png, { x: 15.4, y: 2, width: 10, height: 3.2 }));
    expect([cut.width, cut.height]).toEqual([5, 4]);
    expect([...cut.pixels.subarray(0, 4)]).toEqual([15, 2, 7, 255]);
    expect(() => cropPng(png, { x: 30, y: 0, width: 5, height: 5 })).toThrow(/outside the 20×10 screenshot/);
  });

  it('decodes every PNG row filter (sub, up, average, paeth) and RGB images', () => {
    const w = 3;
    const rows = [
      [1, 10, 20, 30, 5, 5, 5, 5, 5, 5], // sub: deltas to the left pixel
      [2, 1, 1, 1, 1, 1, 1, 1, 1, 1], // up
      [3, 0, 0, 0, 0, 0, 0, 0, 0, 0], // average
      [4, 0, 0, 0, 0, 0, 0, 0, 0, 0], // paeth
    ];
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(rows.length, 4);
    ihdr[8] = 8;
    ihdr[9] = 2; // RGB
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, data, Buffer.alloc(4)]); // CRC is not checked
    };
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.from(rows.flat()))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const img = decodePng(png);
    expect(img.channels).toBe(3);
    expect([...img.pixels.subarray(0, 9)]).toEqual([10, 20, 30, 15, 25, 35, 20, 30, 40]);
    expect([...img.pixels.subarray(9, 18)]).toEqual([11, 21, 31, 16, 26, 36, 21, 31, 41]);
    // average of left (0 for the first pixel) and up: 11>>1=5 ...
    expect([...img.pixels.subarray(18, 21)]).toEqual([5, 10, 15]);
    // paeth predicts from left / up / up-left
    expect(img.pixels.length).toBe(w * 3 * rows.length);
  });

  it('rejects images it cannot crop', () => {
    expect(() => decodePng(Buffer.from('nope'))).toThrow(/not a PNG/);
  });
});

// ---------------------------------------------------------------- launch arguments

describe('launch arguments', () => {
  it('encode as base64 of ASCII-only JSON (non-ASCII escaped) that decodes to the same object', () => {
    const args = { user: '花子', n: 3, ok: true, nested: { list: [1, null, 'x'] } };
    const b64 = encodeLaunchArgs(args);
    expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/);
    const ascii = Buffer.from(b64, 'base64').toString('latin1');
    expect(ascii).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(ascii)).toEqual(args);
  });

  it('reject values JSON cannot carry', () => {
    expect(() => checkLaunchArgs({ when: new Date() }, 'relaunch({ args })')).toThrow(/relaunch\(\{ args \}\)/);
    expect(() => checkLaunchArgs([1], 'x')).toThrow(/plain object/);
    expect(() => checkLaunchArgs({ f: () => 1 }, 'x')).toThrow(/not JSON/);
  });
});

// ---------------------------------------------------------------- Session + app.device / app.sync

class LifecycleProvider extends FakeProvider {
  launches: LaunchParams[] = [];
  urlHandling: 'delivered' | 'needs-native' | undefined;
  png = encodePng(gradient(40, 20));
  /** The app's connections; terminating the app closes the open one, like a real process exit. */
  agents: FakeAgent[] = [];
  constructor(onLaunch: (p: LaunchParams) => void) {
    super(onLaunch);
  }
  override async launch(p: LaunchParams) {
    this.launches.push(p);
    await super.launch(p);
    return p.url !== undefined ? this.urlHandling : undefined;
  }
  override async terminate(opts: { keepData?: boolean } = {}) {
    this.calls.push(opts.keepData === true ? 'terminate:keep' : 'terminate');
    const open = this.agents.at(-1);
    if (open !== undefined && open.ws.readyState === open.ws.OPEN) {
      open.ws.close();
      await open.closed;
    }
  }
  async clearData() {
    this.calls.push('clearData');
  }
  async uninstall() {
    this.calls.push('uninstall');
  }
  async sendToBackground(app: InAppControls) {
    this.calls.push(`background:${String(await app.suspend())}`);
  }
  async bringToForeground() {
    this.calls.push('foreground');
  }
  async reversePort(port: number) {
    this.calls.push(`reverse:${port}`);
  }
  override async screenshot() {
    return this.png;
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
  permissions: ['location'],
  connectTimeoutMs: 2000,
  ...extra,
});

/** Agents answering like the app would; `appState` is what deviceInfo reports. */
function setup(opts: { nativeModule?: boolean } = {}) {
  const state = { appState: 'active' as string, unansweredResets: 0 };
  const agents: FakeAgent[] = [];
  const provider = new LifecycleProvider((p) =>
    agents.push(
      connectAgent(p.port, {
        sessionId: p.sessionId,
        nativeModule: opts.nativeModule ?? true,
        handler: (m) => {
          switch (m) {
            case 'deviceInfo':
              return { window: { width: 20, height: 10 }, pixelRatio: 2, appState: state.appState };
            case 'suspend':
              state.appState = 'background';
              return { suspended: true };
            case 'reset':
              if (state.unansweredResets > 0) {
                state.unansweredResets--;
                return NO_REPLY;
              }
              return { durationMs: 1 };
            case 'query':
            case 'assert':
              return { elements: [{ type: 'RCTView', testID: 'box', text: '', rect: { x: 5, y: 2, width: 4, height: 3 }, visible: true, visibleRatio: 1, focused: false, enabled: true }] };
            default:
              return {};
          }
        },
      }),
    ),
  );
  provider.agents = agents;
  return { provider, agents, state };
}

const methods = (a: FakeAgent | undefined) => a?.requests.map((r) => r.method) ?? [];

describe('app.device', () => {
  it('relaunch: new process with typed args merged over the config, keeping data by default', async () => {
    const { provider, agents } = setup();
    session = await Session.create({ config: config({ launchArgs: { env: 'e2e', n: 1 } }), platform: 'android', provider, logger: silentLogger });
    expect(provider.launches[0]?.argsObject).toEqual({ env: 'e2e', n: 1 });
    expect(JSON.parse(Buffer.from(provider.launches[0]?.args ?? '', 'base64').toString('latin1'))).toEqual({ env: 'e2e', n: 1 });

    provider.calls.length = 0;
    await session.driver.device.relaunch({ args: { n: 2, user: 'ann' } });
    expect(provider.calls).toEqual(['terminate:keep', 'launch']);
    expect(provider.launches[1]?.argsObject).toEqual({ env: 'e2e', n: 2, user: 'ann' });
    expect(agents).toHaveLength(2);
    await session.driver.waitForIdle();
    expect(methods(agents[1])).toEqual(['waitForIdle']);
  });

  it('relaunch({ clearData }) wipes and re-grants permissions; reinstall uninstalls and installs', async () => {
    const { provider } = setup();
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    provider.calls.length = 0;
    await session.driver.device.relaunch({ clearData: true, permissions: ['camera'] });
    expect(provider.calls).toEqual(['terminate', 'clearData', 'grant:location,camera', 'launch']);
    provider.calls.length = 0;
    await session.driver.device.relaunch({ reinstall: true });
    expect(provider.calls).toEqual(['terminate', 'uninstall', 'install', 'grant:location', 'launch']);
  });

  it('relaunch({ url }): delivered by the provider, or opened after the launch when the app lacks @quiesco/native', async () => {
    const native = setup();
    native.provider.urlHandling = 'needs-native';
    session = await Session.create({ config: config(), platform: 'android', provider: native.provider, logger: silentLogger });
    await session.driver.device.relaunch({ url: 'todo://playground' });
    expect(native.provider.launches[1]?.url).toBe('todo://playground');
    expect(methods(native.agents[1])).not.toContain('action');
    await session.dispose();

    const jsOnly = setup({ nativeModule: false });
    jsOnly.provider.urlHandling = 'needs-native';
    session = await Session.create({ config: config(), platform: 'android', provider: jsOnly.provider, logger: silentLogger });
    await session.driver.device.relaunch({ url: 'todo://playground' });
    const action = jsOnly.agents[1]?.requests.find((r) => r.method === 'action');
    expect(action?.params['action']).toEqual({ type: 'openUrl', url: 'todo://playground' });
  });

  it('an app that went away and does not come back is started again before the next scenario (Phase 6.12)', async () => {
    const { provider, agents } = setup();
    session = await Session.create({ config: config({ connectTimeoutMs: 300 }), platform: 'android', provider, logger: silentLogger });
    await session.driver.waitForIdle();
    // The app dies (or never finishes a relaunch) and nothing reconnects.
    agents[0]?.ws.terminate();
    await agents[0]?.closed;
    provider.calls.length = 0;
    await session.beforeScenario({});
    expect(provider.calls.slice(-2)).toEqual(['terminate', 'launch']);
    expect(agents).toHaveLength(2);
    await session.driver.waitForIdle();
    expect(methods(agents[1])).toContain('waitForIdle');
  });

  it('an app that is connected but does not answer the reset (left suspended) is started again (batch D)', async () => {
    const { provider, agents, state } = setup();
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    await session.driver.waitForIdle();
    // The app stops answering (frozen in the background): the reset times out (AGENT_TIMEOUT).
    state.unansweredResets = 1;
    provider.calls.length = 0;
    await session.beforeScenario({});
    expect(methods(agents[0])).toContain('reset');
    expect(provider.calls.slice(-2)).toEqual(['terminate', 'launch']);
    expect(agents).toHaveLength(2);
  }, 40_000);

  it('terminate: element calls fail fast with APP_NOT_RUNNING; the next scenario starts the app again', async () => {
    const { provider, agents } = setup();
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    await session.driver.device.terminate();
    expect(session.driver.device.appState).toBe('terminated');
    await expect(session.driver.query('box')).rejects.toMatchObject({ errorName: 'APP_NOT_RUNNING' });
    // Actions read the connection for the action mode first: they must not wait for a reconnect either.
    await expect(session.driver.tap('box')).rejects.toMatchObject({ errorName: 'APP_NOT_RUNNING' });
    await expect(session.driver.device.sendToBackground()).rejects.toMatchObject({ errorName: 'APP_NOT_RUNNING' });
    await session.beforeScenario({});
    expect(provider.calls.slice(-2)).toEqual(['terminate', 'launch']);
    expect(agents).toHaveLength(2);
    expect(session.driver.device.appState).toBe('running');
  });

  it('background / foreground: the app suspends itself where it can; calls fail with APP_IN_BACKGROUND in between', async () => {
    const { provider, agents, state } = setup();
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    await session.driver.device.sendToBackground();
    expect(provider.calls.at(-1)).toBe('background:true');
    await expect(session.driver.tap('box')).rejects.toMatchObject({ errorName: 'APP_IN_BACKGROUND' });
    state.appState = 'active';
    await session.driver.device.bringToForeground();
    expect(provider.calls.at(-1)).toBe('foreground');
    expect(methods(agents[0]).slice(-2)).toEqual(['configure', 'waitForIdle']);
    await expect(session.driver.query('box')).resolves.toHaveLength(1);
  });

  it('a scenario left in the background is brought back before the next one', async () => {
    const { provider, state } = setup();
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    await session.driver.device.sendToBackground();
    state.appState = 'active';
    await session.beforeScenario({});
    expect(provider.calls).toContain('foreground');
    expect(session.driver.device.appState).toBe('running');
  });

  it('screenshot(element) cuts the element out of the screen (scale = image width / window width)', async () => {
    const { provider } = setup();
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    const png = await session.driver.device.screenshot('box');
    const img = decodePng(png);
    expect([img.width, img.height]).toEqual([8, 6]);
    expect([...img.pixels.subarray(0, 4)]).toEqual([10, 4, 7, 255]);
    expect(await session.driver.device.screenshot()).toBe(provider.png);
  });

  it('reversePort validates and delegates; unsupported actions say so', async () => {
    const { provider } = setup();
    session = await Session.create({ config: config(), platform: 'android', provider, logger: silentLogger });
    await session.driver.device.reversePort(3001);
    expect(provider.calls.at(-1)).toBe('reverse:3001');
    await expect(session.driver.device.reversePort(0)).rejects.toThrow(RangeError);
    await expect(session.driver.device.relaunch({ args: { d: new Date() } as never })).rejects.toMatchObject({ errorName: 'CONFIG_ERROR' });
  });
});

describe('Driver app-state check', () => {
  it('fails actions and queries at once while the app is terminated / in the background, without waiting for a reconnect', async () => {
    let state: 'terminated' | 'background' = 'terminated';
    // A terminated app never reconnects: the connection promise never settles.
    const driver = new Driver({ provider: new FakeProvider(), connection: () => new Promise(() => {}), defaultTimeoutMs: 1000, appState: () => state });
    await expect(driver.tap('box')).rejects.toMatchObject({ errorName: 'APP_NOT_RUNNING' });
    await expect(driver.query('box')).rejects.toMatchObject({ errorName: 'APP_NOT_RUNNING' });
    state = 'background';
    await expect(driver.swipe('list', 'up')).rejects.toMatchObject({ errorName: 'APP_IN_BACKGROUND' });
  });
});

describe('app.sync', () => {
  it('changes the agent config at runtime and restores it before the next scenario', async () => {
    const { provider, agents } = setup();
    session = await Session.create({ config: config({ sync: { ignoreUrls: ['/health'] } }), platform: 'android', provider, logger: silentLogger });
    const sync = session.driver.sync;
    await sync.disableTracker('timer');
    await sync.ignoreUrls.add(/poll/);
    await sync.ignoreUrls.remove('/health');
    await sync.ignoreElements.add('spinner');
    const sent = agents[0]?.requests.filter((r) => r.method === 'configure').at(-1)?.params['config'] as { sync: Record<string, unknown> };
    expect(sent.sync['trackers']).toEqual({ timer: false });
    expect(sent.sync['ignoreUrls']).toEqual([{ regex: { source: 'poll', flags: '' } }]);
    expect(sent.sync['ignoreElements']).toEqual([{ id: 'spinner' }]);

    await sync.disable();
    expect(sync.current().sync.trackers).toEqual({ network: false, timer: false, react: false, 'idle-callback': false, 'frame-stable': false, native: false });
    await sync.enable();
    expect(sync.current().sync.trackers).toEqual({ timer: false });

    // A relaunch's hello carries the changes.
    await session.driver.device.relaunch();
    expect((await agents[1]!.hello).result?.config.sync.trackers).toEqual({ timer: false });

    await session.beforeScenario({});
    expect(sync.changed).toBe(false);
    const restored = agents[1]?.requests.filter((r) => r.method === 'configure').at(-1)?.params['config'] as { sync: Record<string, unknown> };
    expect(restored.sync['trackers']).toEqual({});
    expect(restored.sync['ignoreUrls']).toEqual(['/health']);
    await expect(sync.disableTracker('nope' as never)).rejects.toThrow(/unknown tracker/);
  });
});
