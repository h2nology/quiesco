import { afterEach, describe, expect, it } from 'vitest';

import type { Orientation } from '@quiesco/protocol';

import type { QuiescoConfig } from '../src/config';
import type { Permission } from '../src/devices/permissions';
import type { ColorScheme, InAppControls, LaunchParams, NotificationSpec, StateChange, StatusBarOptions } from '../src/devices/provider';
import { silentLogger } from '../src/logger';
import { Session } from '../src/session';
import { connectAgent } from './helpers/fake-agent';
import type { FakeAgent } from './helpers/fake-agent';
import { FakeProvider } from './helpers/fake-provider';

/** What the app would report; the provider changes it like the real device would. */
interface AppView {
  width: number;
  height: number;
  colorScheme: ColorScheme;
  fontScale: number;
  locale: string;
}

/** Device-state methods recording calls; `honors` = whether the app follows the system (else it locks the setting). */
class StateProvider extends FakeProvider {
  app: AppView = { width: 400, height: 800, colorScheme: 'light', fontScale: 1, locale: 'en-US' };
  honors = true;
  revokeKills = false;
  locale: string | null = null;
  constructor(onLaunch: (p: LaunchParams) => void) {
    super(onLaunch);
  }
  override async launch(p: LaunchParams) {
    if (this.locale !== null && this.honors) this.app.locale = this.locale;
    await super.launch(p);
  }
  override async terminate(opts: { keepData?: boolean } = {}) {
    this.calls.push(opts.keepData === true ? 'terminate:keep' : 'terminate');
  }
  async setOrientation(o: Orientation, app: InAppControls) {
    this.calls.push(`orientation:${o}:${(await app.setOrientation(o)).supported}`);
    if (this.honors) [this.app.width, this.app.height] = o === 'landscape' ? [800, 400] : [400, 800];
  }
  async setLocation(l: { latitude: number; longitude: number }) {
    this.calls.push(`location:${l.latitude},${l.longitude}`);
  }
  async setPermission(perm: Permission, grant: boolean): Promise<StateChange> {
    this.calls.push(`${grant ? 'grant' : 'revoke'}:${perm}`);
    return { relaunch: !grant && this.revokeKills };
  }
  async setAppearance(s: ColorScheme) {
    this.calls.push(`appearance:${s}`);
    if (this.honors) this.app.colorScheme = s;
  }
  fontRelaunch = false;
  async setFontScale(n: number) {
    this.calls.push(`font:${n}`);
    this.app.fontScale = n;
    return { scale: n, relaunch: this.fontRelaunch };
  }
  async setLocale(l: string | null): Promise<StateChange> {
    this.calls.push(`locale:${String(l)}`);
    this.locale = l;
    return { relaunch: true };
  }
  async setStatusBar(o: StatusBarOptions) {
    this.calls.push(`statusBar:${JSON.stringify(o)}`);
  }
  async resetStatusBar() {
    this.calls.push('statusBar:clear');
  }
  async setNetwork(offline: boolean) {
    this.calls.push(`network:${offline ? 'offline' : 'online'}`);
  }
  async setClipboard(text: string, app: InAppControls) {
    this.calls.push(`clipboard:${text}:${(await app.setClipboard(text)).supported}`);
  }
  async getClipboard(app: InAppControls) {
    return (await app.getClipboard()).text ?? '';
  }
  enrollLeavesApp = false;
  async setBiometricEnrollment(enrolled: boolean) {
    this.calls.push(`enroll:${enrolled}`);
    return { leftApp: this.enrollLeavesApp };
  }
  async bringToForeground() {
    this.calls.push('foreground');
  }
  async presentBiometric(match: boolean) {
    this.calls.push(match ? 'biometric:match' : 'biometric:fail');
  }
  async shake() {
    this.calls.push('shake');
  }
  async clearKeychain() {
    this.calls.push('keychain');
  }
  async sendNotification(n: NotificationSpec, app: InAppControls) {
    this.calls.push(`notify:${n.title}:${(await app.postNotification(n)).enabled}`);
  }
  async openNotification(title: string) {
    this.calls.push(`open:${title}`);
  }
  async resetDeviceState(): Promise<StateChange> {
    this.calls.push('reset');
    const relaunch = this.locale !== null;
    this.locale = null;
    this.app = { width: 400, height: 800, colorScheme: 'light', fontScale: 1, locale: 'en-US' };
    return { relaunch };
  }
}

let session: Session | null = null;
afterEach(async () => {
  await session?.dispose();
  session = null;
});

async function start(extra: Partial<QuiescoConfig> = {}) {
  const agents: FakeAgent[] = [];
  let clip = '';
  const provider: StateProvider = new StateProvider((p) =>
    agents.push(
      connectAgent(p.port, {
        sessionId: p.sessionId,
        nativeModule: true,
        handler: (m, p) => {
          const a = provider.app;
          if (m === 'deviceInfo') return { window: { width: a.width, height: a.height }, pixelRatio: 2, appState: 'active', colorScheme: a.colorScheme, fontScale: a.fontScale, locale: a.locale };
          if (m === 'setOrientation') return { supported: true };
          if (m === 'getClipboard') return { supported: true, text: clip };
          if (m === 'postNotification') return { supported: true, enabled: true };
          if (m === 'setClipboard') {
            clip = (p as { text: string }).text;
            return { supported: true };
          }
          if (m === 'reset') return { durationMs: 1 };
          return {};
        },
      }),
    ),
  );
  session = await Session.create({
    config: { apps: { android: { package: 'p' } }, server: { port: 0, host: '127.0.0.1' }, permissions: ['location'], connectTimeoutMs: 2000, ...extra },
    platform: 'android',
    provider,
    logger: silentLogger,
  });
  provider.calls.length = 0;
  return { provider, agents, device: session.driver.device };
}

const methods = (a: FakeAgent | undefined) => a?.requests.map((r) => r.method) ?? [];

describe('app.device state (Phase 6.6)', () => {
  it('setOrientation rotates (through the app where the provider needs it) and waits for the window and idle', async () => {
    const { provider, agents, device } = await start();
    await device.setOrientation('landscape');
    expect(provider.calls).toEqual(['orientation:landscape:true']);
    expect(methods(agents[0])).toEqual(['setOrientation', 'deviceInfo', 'waitForIdle']);
    await expect(device.setOrientation('upside-down' as never)).rejects.toThrow(RangeError);
  });

  it('explains when the app does not follow: locked orientation, forced color scheme, unsupported language', async () => {
    const { provider, device } = await start();
    provider.honors = false;
    await expect(device.setOrientation('landscape')).rejects.toThrow(/lock its orientation/);
    await expect(device.setAppearance('dark')).rejects.toThrow(/userInterfaceStyle/);
    await expect(device.setLocale('ja-JP')).rejects.toThrow(/CFBundleLocalizations/);
  }, 30_000);

  it('setAppearance / setFontScale wait until the app reports the new value', async () => {
    const { provider, device } = await start();
    await device.setAppearance('dark');
    await expect(device.setFontScale(1.3)).resolves.toBe(1.3);
    expect(provider.app).toMatchObject({ colorScheme: 'dark', fontScale: 1.3 });
    await expect(device.setFontScale(9)).rejects.toThrow(RangeError);
    // Where the platform would recreate the activity (Android), the app is started again first.
    provider.fontRelaunch = true;
    provider.calls.length = 0;
    await device.setFontScale(1.5);
    expect(provider.calls).toEqual(['font:1.5', 'terminate:keep', 'launch']);
  });

  it('setLocale starts the app again when the platform needs it, then checks the locale', async () => {
    const { provider, agents, device } = await start();
    await device.setLocale('ja-JP');
    expect(provider.calls).toEqual(['locale:ja-JP', 'terminate:keep', 'launch']);
    expect(agents).toHaveLength(2);
    expect(provider.app.locale).toBe('ja-JP');
    await expect(device.setLocale('日本語')).rejects.toThrow(RangeError);
  });

  it('setPermission: a revoke that kills the app (Android) relaunches it, keeping data', async () => {
    const { provider, agents, device } = await start();
    await device.setPermission('camera', 'grant');
    expect(provider.calls).toEqual(['grant:camera']);
    provider.revokeKills = true;
    await device.setPermission('location', 'revoke');
    expect(provider.calls.slice(1)).toEqual(['revoke:location', 'terminate:keep', 'launch']);
    expect(agents).toHaveLength(2);
  });

  it('before the next scenario: permissions back to the configured ones, the rest reset by the provider (relaunch for a locale)', async () => {
    const { provider, agents } = await start();
    const device = session!.driver.device;
    await device.setPermission('camera', 'grant');
    await device.setPermission('location', 'revoke');
    await device.setLocale('ja-JP');
    await device.setLocation(35.68, 139.76);
    provider.calls.length = 0;
    await session!.beforeScenario({});
    expect(provider.calls).toEqual(['revoke:camera', 'grant:location', 'reset', 'terminate:keep', 'launch']);
    expect(provider.app.locale).toBe('en-US');
    expect(methods(agents.at(-1))).toEqual(['reset']);
    provider.calls.length = 0;
    await session!.beforeScenario({});
    expect(provider.calls).toEqual(['reset']);

    // The end of the session leaves the device as it was, without starting the app again.
    await device.setLocale('ja-JP');
    provider.calls.length = 0;
    await session!.dispose();
    session = null;
    expect(provider.calls).toEqual(['reset', 'shutdown']);
  });

  it('setNetwork: the agent blocks first going offline, the device network comes back first going online; the next hello carries it', async () => {
    const { provider, agents } = await start();
    const device = session!.driver.device;
    const configures = () => agents[0]?.requests.filter((r) => r.method === 'configure').map((r) => (r.params['config'] as { network?: unknown }).network ?? 'online');
    await device.setNetwork('offline');
    expect(provider.calls).toEqual(['network:offline']);
    expect(configures()).toEqual([{ offline: true }]);
    expect(session!.server.agentConfig.network).toEqual({ offline: true });
    // app.sync changes keep the offline mode.
    await session!.sync.disableTracker('timer');
    expect(configures()).toEqual([{ offline: true }, { offline: true }]);
    await device.setNetwork('online');
    expect(provider.calls).toEqual(['network:offline', 'network:online']);
    expect(configures()?.at(-1)).toBe('online');
    await expect(device.setNetwork('airplane' as never)).rejects.toThrow(RangeError);
  });

  it('before the next scenario: back online (the provider restores the device network in its reset)', async () => {
    const { provider, agents } = await start();
    await session!.driver.device.setNetwork('offline');
    provider.calls.length = 0;
    await session!.beforeScenario({});
    expect(provider.calls).toEqual(['reset']);
    expect(session!.server.agentConfig.network).toBeUndefined();
    const last = agents[0]?.requests.filter((r) => r.method === 'configure').at(-1);
    expect((last?.params['config'] as { network?: unknown }).network).toBeUndefined();
  });

  it('clipboard: set / get through the app; cleared before the next scenario', async () => {
    const { provider, agents } = await start();
    const device = session!.driver.device;
    await device.clipboard.set('こんにちは');
    expect(await device.clipboard.get()).toBe('こんにちは');
    expect(provider.calls).toEqual(['clipboard:こんにちは:true']);
    provider.calls.length = 0;
    await session!.beforeScenario({});
    expect(provider.calls).toEqual(['clipboard::true', 'reset']);
    expect(methods(agents[0])).toContain('setClipboard');
    provider.calls.length = 0;
    await session!.beforeScenario({});
    expect(provider.calls).toEqual(['reset']);
    await device.terminate();
    await expect(device.clipboard.get()).rejects.toMatchObject({ errorName: 'APP_NOT_RUNNING' });
  });

  it('setStatusBar validates its options before reaching the provider', async () => {
    const { provider } = await start();
    const device = session!.driver.device;
    await device.setStatusBar({ time: '9:41', batteryLevel: 100, charging: false, wifiBars: 3, cellularBars: 4, dataNetwork: 'lte' });
    await device.resetStatusBar();
    expect(provider.calls).toEqual(['statusBar:{"time":"9:41","batteryLevel":100,"charging":false,"wifiBars":3,"cellularBars":4,"dataNetwork":"lte"}', 'statusBar:clear']);
    await expect(device.setStatusBar({})).rejects.toThrow(/at least one/);
    await expect(device.setStatusBar({ time: '25:00' })).rejects.toThrow(/H:MM/);
    await expect(device.setStatusBar({ wifiBars: 4 })).rejects.toThrow(/0-3/);
    await expect(device.setStatusBar({ batteryLevel: 50.5 })).rejects.toThrow(/0-100/);
    await expect(device.setStatusBar({ dataNetwork: '6g' as never })).rejects.toThrow(/dataNetwork/);
    await expect(device.setStatusBar({ clock: '9:41' } as never)).rejects.toThrow(/unknown option clock/);
  });

  it('biometrics / shake / keychain (Phase 6.7): an enrollment that left the app brings it back and waits for it', async () => {
    const { provider, agents } = await start();
    const device = session!.driver.device;
    await device.biometrics.enroll();
    provider.enrollLeavesApp = true;
    await device.biometrics.enroll(true);
    expect(provider.calls).toEqual(['enroll:true', 'enroll:true', 'foreground']);
    expect(device.appState).toBe('running');
    await device.biometrics.match();
    await device.biometrics.fail();
    agents[0]!.requests.length = 0;
    await device.shake();
    expect(methods(agents[0])).toEqual(['waitForIdle']);
    await device.clearKeychain();
    expect(provider.calls.slice(3)).toEqual(['biometric:match', 'biometric:fail', 'shake', 'keychain']);
    await expect(device.biometrics.enroll('yes' as never)).rejects.toThrow(TypeError);
    await device.terminate();
    await expect(device.biometrics.match()).rejects.toMatchObject({ errorName: 'APP_NOT_RUNNING' });
    await expect(device.shake()).rejects.toMatchObject({ errorName: 'APP_NOT_RUNNING' });
    // Enrolling needs no running app; nothing to bring back then.
    provider.calls.length = 0;
    await device.biometrics.enroll(false);
    expect(provider.calls).toEqual(['enroll:false']);
  });

  it('notifications (Phase 6.7): sent through the provider (also in the background); opening one brings the app back and waits for it', async () => {
    const { provider, agents } = await start();
    const device = session!.driver.device;
    await device.sendNotification({ title: 'Hello', body: 'b', data: { k: 'v' } });
    expect(agents[0]!.requests.find((r) => r.method === 'postNotification')?.params).toEqual({ title: 'Hello', body: 'b', data: { k: 'v' } });
    await device.sendToBackground().catch(() => undefined); // the fake provider has no background: set the state by hand
    (session as unknown as { appState: string }).appState = 'background';
    await device.sendNotification({ title: 'Later' });
    agents[0]!.requests.length = 0;
    await device.openNotification('Later');
    expect(device.appState).toBe('running');
    expect(methods(agents[0])).toEqual(['deviceInfo', 'configure', 'waitForIdle']);
    expect(provider.calls.filter((c) => /notify|open/.test(c))).toEqual(['notify:Hello:true', 'notify:Later:true', 'open:Later']);
    await expect(device.sendNotification({ title: '' })).rejects.toThrow(TypeError);
    await expect(device.sendNotification({ title: 'x', data: { n: 1 as never } })).rejects.toThrow(/data.n must be a string/);
    await device.terminate();
    await expect(device.sendNotification({ title: 'x' })).rejects.toMatchObject({ errorName: 'APP_NOT_RUNNING' });
    await expect(device.openNotification('x')).rejects.toMatchObject({ errorName: 'APP_NOT_RUNNING' });
  });

  it('validates locations; platforms without a method say so', async () => {
    const { device } = await start();
    await expect(device.setLocation(91, 0)).rejects.toThrow(RangeError);
    const bare = new FakeProvider(() => {});
    expect(bare.platform).toBe('android');
  });
});

describe('app.device state on a provider without it', () => {
  it('reports ACTION_NOT_SUPPORTED with the platform', async () => {
    const agents: FakeAgent[] = [];
    const provider = new FakeProvider((p) => agents.push(connectAgent(p.port, { sessionId: p.sessionId })));
    session = await Session.create({ config: { apps: { android: { package: 'p' } }, server: { port: 0, host: '127.0.0.1' }, connectTimeoutMs: 2000 }, platform: 'android', provider, logger: silentLogger });
    await expect(session.driver.device.setFontScale(1.2)).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', data: { action: 'setFontScale', platform: 'android' } });
    await expect(session.driver.device.clipboard.get()).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', data: { action: 'clipboard.get' } });
    await expect(session.driver.device.setStatusBar({ time: '9:41' })).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
    await expect(session.driver.device.biometrics.enroll()).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', data: { action: 'biometrics.enroll' } });
    await expect(session.driver.device.shake()).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', data: { action: 'shake' } });
    await expect(session.driver.device.openNotification('x')).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', data: { action: 'openNotification' } });
    await expect(session.driver.device.clearKeychain()).rejects.toThrow(/Android has no keychain: relaunch\(\{ clearData: true \}\)/);
    // The agent alone can still simulate offline mode.
    await session.driver.device.setNetwork('offline');
    expect(session.server.agentConfig.network).toEqual({ offline: true });
  });
});
