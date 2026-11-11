import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Exec } from '../src/devices/exec';
import { fakeSpawner } from './helpers/fake-child';
import { IOS_DEV_MENU_ARGS, IOS_RESTRICTION_FILES, IosProvider, chooseSimulator, iosLocaleArgs, nearestContentSize, runtimeMatches } from '../src/devices/ios';
import type { IosProviderOptions, SimDevice } from '../src/devices/ios';

const R27 = 'com.apple.CoreSimulator.SimRuntime.iOS-27-0';
const R265 = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
const LIST = JSON.stringify({
  devices: {
    [R265]: [{ udid: 'OLD-17', name: 'iPhone 17', state: 'Shutdown', isAvailable: true }],
    [R27]: [
      { udid: 'AIR', name: 'iPhone Air', state: 'Shutdown', isAvailable: true },
      { udid: 'NEW-17', name: 'iPhone 17', state: 'Booted', isAvailable: true },
    ],
  },
});

/** Fake xcrun: answers by matching the joined command line. */
function fakeXcrun(answers: [RegExp, string | Error][] = []) {
  const calls: string[] = [];
  const exec: Exec = async (file, args) => {
    const line = `${file} ${args.join(' ')}`;
    calls.push(line);
    if (args[1] === 'io' && args[3] === 'screenshot') fs.writeFileSync(args[5] as string, 'PNGDATA');
    for (const [re, out] of answers) {
      if (re.test(line)) {
        if (out instanceof Error) throw out;
        return { stdout: Buffer.from(out), stderr: '' };
      }
    }
    return { stdout: Buffer.from(''), stderr: '' };
  };
  return { exec, calls };
}

function provider(answers: [RegExp, string | Error][], opts: Partial<IosProviderOptions> = {}) {
  const x = fakeXcrun([[/list devices available --json/, LIST], ...answers]);
  const warnings: string[] = [];
  const logger = { debug() {}, info() {}, warn: (m: string) => void warnings.push(m), error() {} };
  const p = new IosProvider({ app: { bundleId: 'com.example.todo' }, exec: x.exec, logger, ...opts });
  return { p, calls: x.calls, warnings };
}

describe('simulator selection', () => {
  const devices: SimDevice[] = [
    { udid: 'OLD-17', name: 'iPhone 17', state: 'Shutdown', runtime: R265 },
    { udid: 'AIR', name: 'iPhone Air', state: 'Shutdown', runtime: R27 },
    { udid: 'NEW-17', name: 'iPhone 17', state: 'Booted', runtime: R27 },
  ];

  it('matches runtime versions written as 27.0, iOS 27.0 or 26.5', () => {
    expect(runtimeMatches(R27, '27.0')).toBe(true);
    expect(runtimeMatches(R27, 'iOS 27.0')).toBe(true);
    expect(runtimeMatches(R27, '26.5')).toBe(false);
    expect(runtimeMatches(R265, '26.5')).toBe(true);
  });

  it('udid wins; a name prefers the booted simulator; os narrows the runtime', () => {
    expect(chooseSimulator(devices, { udid: 'AIR' }).udid).toBe('AIR');
    expect(chooseSimulator(devices, { device: 'iPhone 17' }).udid).toBe('NEW-17');
    expect(chooseSimulator(devices, { device: 'iPhone 17', os: '26.5' }).udid).toBe('OLD-17');
    expect(chooseSimulator(devices, {}).udid).toBe('NEW-17');
  });

  it('explains what is available when nothing matches', () => {
    expect(() => chooseSimulator(devices, { device: 'iPhone 99' })).toThrow(/Available: iPhone 17 \(iOS-26-5, Shutdown\), iPhone Air/);
    expect(() => chooseSimulator(devices, { udid: 'NOPE' })).toThrow(/udid NOPE/);
    expect(() => chooseSimulator(devices.filter((d) => d.state !== 'Booted'), {})).toThrow(/No simulator is booted; set devices.ios.device/);
  });
});

describe('IosProvider', () => {
  it('attaches to a booted simulator and waits for bootstatus', async () => {
    const { p, calls } = provider([], { device: { device: 'iPhone 17', os: '27.0' } });
    await p.boot();
    expect(calls).toEqual(['xcrun simctl list devices available --json', 'xcrun simctl bootstatus NEW-17 -b']);
  });

  it('boots a shut-down simulator, and shuts it down at the end only when asked to', async () => {
    const { p, calls } = provider([], { device: { device: 'iPhone Air', shutdown: true } });
    await p.boot();
    await p.shutdown();
    expect(calls).toEqual(['xcrun simctl list devices available --json', 'xcrun simctl boot AIR', 'xcrun simctl bootstatus AIR -b', 'xcrun simctl shutdown AIR']);

    const kept = provider([], { device: { device: 'iPhone Air' } });
    await kept.p.boot();
    await kept.p.shutdown();
    expect(kept.calls).not.toContain('xcrun simctl shutdown AIR');
  });

  it('turns password AutoFill off in the simulator restriction profiles (unless disabled)', async () => {
    const withData = JSON.stringify({ devices: { [R27]: [{ udid: 'NEW-17', name: 'iPhone 17', state: 'Booted', dataPath: '/sim/NEW-17/data' }] } });
    const x = fakeXcrun([[/list devices available --json/, withData]]);
    const p = new IosProvider({ app: { bundleId: 'com.example.todo' }, exec: x.exec });
    await p.boot();
    expect(x.calls.filter((c) => c.startsWith('plutil'))).toEqual(
      IOS_RESTRICTION_FILES.map((f) => `plutil -replace restrictedBool.allowPasswordAutoFill.value -bool NO /sim/NEW-17/data/${f}`),
    );

    const off = fakeXcrun([[/list devices available --json/, withData]]);
    await new IosProvider({ app: { bundleId: 'com.example.todo' }, device: { disablePasswordAutoFill: false }, exec: off.exec }).boot();
    expect(off.calls.some((c) => c.startsWith('plutil'))).toBe(false);
  });

  it('installs the .app when given, else checks the app is installed', async () => {
    const withApp = provider([], { app: { bundleId: 'com.example.todo', binaryPath: '/abs/Todo.app' } });
    await withApp.p.boot();
    await withApp.p.install();
    expect(withApp.calls.at(-1)).toBe('xcrun simctl install NEW-17 /abs/Todo.app');

    const missing = provider([[/get_app_container/, new Error('No such app')]]);
    await missing.p.boot();
    await expect(missing.p.install()).rejects.toThrow(/com.example.todo is not installed on iPhone 17; set apps.ios.binaryPath/);
  });

  it('launches with the connection parameters as -key value arguments', async () => {
    const { p, calls } = provider([]);
    await p.boot();
    await p.launch({ port: 7357, sessionId: 'abc-123' });
    expect(calls.at(-1)).toBe('xcrun simctl launch --terminate-running-process NEW-17 com.example.todo -quiescoPort 7357 -quiescoSession abc-123');
  });

  it('dev clients: --initialUrl with the Metro URL and the expo-dev-menu switches (no menu, onboarding or floating button)', async () => {
    const { p, calls } = provider([], { app: { bundleId: 'com.example.todo', devClient: { metroUrl: 'http://localhost:8082' } } });
    await p.boot();
    await p.launch({ port: 7357, sessionId: 's' });
    expect(calls.at(-1)).toBe(
      `xcrun simctl launch --terminate-running-process NEW-17 com.example.todo --initialUrl http://localhost:8082 ${IOS_DEV_MENU_ARGS.join(' ')} -quiescoPort 7357 -quiescoSession s`,
    );
    expect(IOS_DEV_MENU_ARGS).toEqual([
      '-EXDevMenuShowsAtLaunch', 'NO', '-EXDevMenuIsOnboardingFinished', 'YES', '-EXDevMenuShowFloatingActionButton', 'NO', '-EXDevMenuDisableAutoLaunch', 'YES', '-EXDevMenuMotionGestureEnabled', 'NO',
    ]);
  });

  it('terminate ignores "not running"', async () => {
    const { p } = provider([[/terminate/, new Error('found nothing to terminate')]]);
    await p.boot();
    await expect(p.terminate()).resolves.toBeUndefined();
  });

  it('maps permissions to simctl privacy services and warns for the ones it has not', async () => {
    const { p, calls, warnings } = provider([]);
    await p.boot();
    await p.grantPermissions(['location', 'photos', 'camera', 'notifications']);
    expect(calls.filter((c) => c.includes('privacy'))).toEqual([
      'xcrun simctl privacy NEW-17 grant location com.example.todo',
      'xcrun simctl privacy NEW-17 grant photos com.example.todo',
    ]);
    expect(warnings.filter((w) => w.includes('pre-granted'))).toEqual([
      expect.stringContaining('"camera" cannot be pre-granted'),
      expect.stringContaining('"notifications" cannot be pre-granted'),
    ]);
  });

  it('takes screenshots through a temporary file', async () => {
    const { p, calls } = provider([]);
    await p.boot();
    expect((await p.screenshot()).toString()).toBe('PNGDATA');
    expect(calls.at(-1)).toMatch(/^xcrun simctl io NEW-17 screenshot --type=png .*screen\.png$/);
  });

  it('rejects pressBack (no system back button) and host deep links (simctl openurl shows an alert)', async () => {
    const { p } = provider([]);
    await p.boot();
    await expect(p.injectInput({ kind: 'back' })).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', message: expect.stringContaining('no system back button') });
    await expect(p.injectInput({ kind: 'navigate', url: 'app://x' })).rejects.toMatchObject({
      errorName: 'ACTION_NOT_SUPPORTED',
      message: expect.stringContaining('needs @quiesco/native'),
    });
    await expect(p.injectInput({ kind: 'tap', x: 1, y: 2 })).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
  });

  it('diagnoses whether the app process is running', async () => {
    const running = provider([[/launchctl list/, '123\t0\tUIKitApplication:com.example.todo[a1b2][rb-legacy]\n']]);
    await running.p.boot();
    expect(await running.p.diagnose({ port: 7357, sessionId: 's' })).toEqual([expect.stringContaining('ws://localhost:7357'), 'com.example.todo is running on iPhone 17.']);

    const dead = provider([]);
    await dead.p.boot();
    expect((await dead.p.diagnose({ port: 7357, sessionId: 's' }))[1]).toMatch(/is NOT running on iPhone 17/);
  });
});

describe('IosProvider lifecycle (Phase 6.5)', () => {
  it('passes launch arguments and the launch URL as -key value arguments; the URL needs @quiesco/native', async () => {
    const { p, calls } = provider([]);
    await p.boot();
    await expect(p.launch({ port: 7357, sessionId: 's', args: 'eyJhIjoxfQ==', url: 'todo://playground' })).resolves.toBe('needs-native');
    expect(calls.at(-1)).toBe('xcrun simctl launch --terminate-running-process NEW-17 com.example.todo -quiescoPort 7357 -quiescoSession s -quiescoArgs eyJhIjoxfQ== -quiescoUrl todo://playground');
  });

  it('clears the data container and UserDefaults, keeping the container folders', async () => {
    const data = fs.mkdtempSync(`${fs.realpathSync('/tmp')}/qs-ios-`);
    for (const d of ['Documents', 'Library/Preferences', 'tmp']) fs.mkdirSync(`${data}/${d}`, { recursive: true });
    fs.writeFileSync(`${data}/Documents/a.json`, '{}');
    fs.writeFileSync(`${data}/Library/Preferences/com.example.todo.plist`, 'x');
    const { p, calls } = provider([[/get_app_container NEW-17 com.example.todo data/, `${data}\n`]]);
    await p.boot();
    calls.length = 0;
    await p.clearData();
    expect(calls).toEqual([
      'xcrun simctl terminate NEW-17 com.example.todo',
      'xcrun simctl spawn NEW-17 defaults delete com.example.todo',
      'xcrun simctl get_app_container NEW-17 com.example.todo data',
    ]);
    expect(fs.readdirSync(data).sort()).toEqual(['Documents', 'Library', 'tmp']);
    expect(fs.readdirSync(`${data}/Documents`)).toEqual([]);
    expect(fs.readdirSync(`${data}/Library`)).toEqual([]);
    fs.rmSync(data, { recursive: true, force: true });
  });

  it('suspends inside the app, or opens Settings when the app cannot; foreground without terminating', async () => {
    const { p, calls } = provider([]);
    await p.boot();
    calls.length = 0;
    await p.sendToBackground({ suspend: async () => true });
    expect(calls).toEqual([]);
    await p.sendToBackground({ suspend: async () => false });
    expect(calls).toEqual(['xcrun simctl launch NEW-17 com.apple.Preferences']);
    await p.bringToForeground();
    expect(calls.at(-1)).toBe('xcrun simctl launch NEW-17 com.example.todo');
    await p.uninstall();
    expect(calls.slice(-2)).toEqual(['xcrun simctl terminate NEW-17 com.example.todo', 'xcrun simctl uninstall NEW-17 com.example.todo']);
    await p.reversePort();
  });
});

describe('IosProvider device state (Phase 6.6)', () => {
  const inApp = (r: { supported: boolean; error?: string }) => ({
    suspend: async () => false,
    setOrientation: async () => r,
    getClipboard: async () => ({ supported: false }),
    setClipboard: async () => ({ supported: false }),
    postNotification: async () => ({ supported: false }),
  });

  it('maps a font scale to the nearest Dynamic Type size (React Native multipliers) and builds locale arguments', () => {
    expect(nearestContentSize(1)).toEqual(['large', 1]);
    expect(nearestContentSize(1.25)).toEqual(['extra-extra-large', 1.235]);
    expect(nearestContentSize(1.3)).toEqual(['extra-extra-extra-large', 1.353]);
    expect(nearestContentSize(2.6)).toEqual(['accessibility-extra-large', 2.643]);
    expect(nearestContentSize(9)).toEqual(['accessibility-extra-extra-extra-large', 3.571]);
    expect(iosLocaleArgs('ja-JP')).toEqual(['-AppleLanguages', '(ja-JP)', '-AppleLocale', 'ja_JP']);
  });

  it('overrides the status bar with simctl and clears it on reset', async () => {
    const { p, calls } = provider([]);
    await p.boot();
    calls.length = 0;
    await p.setStatusBar({ time: '9:41', batteryLevel: 100, charging: true, wifiBars: 3, cellularBars: 4, dataNetwork: '5g' });
    await p.resetStatusBar();
    await p.setStatusBar({ time: '10:30' });
    await p.resetDeviceState(inApp({ supported: true }));
    expect(calls).toEqual([
      'xcrun simctl status_bar NEW-17 override --time 9:41 --batteryLevel 100 --batteryState charging --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --dataNetwork 5g',
      'xcrun simctl status_bar NEW-17 clear',
      'xcrun simctl status_bar NEW-17 override --time 10:30',
      'xcrun simctl status_bar NEW-17 clear',
    ]);
  });

  it('clipboard: written through the app (never pbcopy); read through the app, else pbpaste', async () => {
    const { p, calls } = provider([[/pbpaste/, 'from the Mac']]);
    await p.boot();
    calls.length = 0;
    let clip = '';
    const app = {
      ...inApp({ supported: true }),
      getClipboard: async () => ({ supported: true, text: clip }),
      setClipboard: async (t: string) => {
        clip = t;
        return { supported: true };
      },
    };
    await p.setClipboard('hello', app);
    await expect(p.getClipboard(app)).resolves.toBe('hello');
    expect(calls).toEqual([]);
    const without = { ...app, getClipboard: async () => ({ supported: false }), setClipboard: async () => ({ supported: false }) };
    await expect(p.setClipboard('x', without)).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', data: { action: 'clipboard.set', platform: 'ios' } });
    await expect(p.getClipboard(without)).resolves.toBe('from the Mac');
    expect(calls).toEqual(['xcrun simctl pbpaste NEW-17']);
  });

  it('Face ID / Touch ID, shake and keychain through simctl (notifyutil inside the simulator); enrollment restored on reset', async () => {
    const { p, calls } = provider([[/notifyutil -g/, 'com.apple.BiometricKit.enrollmentChanged 0\n']]);
    await p.boot();
    calls.length = 0;
    await expect(p.setBiometricEnrollment(true)).resolves.toEqual({ leftApp: false });
    await p.presentBiometric(true);
    await p.presentBiometric(false);
    await p.shake();
    await p.clearKeychain();
    const n = (...a: string[]) => `xcrun simctl spawn NEW-17 notifyutil ${a.join(' ')}`;
    expect(calls).toEqual([
      n('-g', 'com.apple.BiometricKit.enrollmentChanged'),
      n('-s', 'com.apple.BiometricKit.enrollmentChanged', '1'),
      n('-p', 'com.apple.BiometricKit.enrollmentChanged'),
      n('-p', 'com.apple.BiometricKit_Sim.pearl.match'),
      n('-p', 'com.apple.BiometricKit_Sim.fingerTouch.match'),
      n('-p', 'com.apple.BiometricKit_Sim.pearl.nomatch'),
      n('-p', 'com.apple.BiometricKit_Sim.fingerTouch.nomatch'),
      n('-p', 'com.apple.UIKit.SimulatorShake'),
      'xcrun simctl keychain NEW-17 reset',
    ]);
    calls.length = 0;
    await p.setBiometricEnrollment(false); // the value to restore stays the one from before the first change
    await p.resetDeviceState(inApp({ supported: true }));
    expect(calls).toEqual([
      n('-s', 'com.apple.BiometricKit.enrollmentChanged', '0'),
      n('-p', 'com.apple.BiometricKit.enrollmentChanged'),
      n('-s', 'com.apple.BiometricKit.enrollmentChanged', '0'),
      n('-p', 'com.apple.BiometricKit.enrollmentChanged'),
    ]);
  });

  it('sends a notification as a simulated push: data next to aps, the payload file removed afterwards', async () => {
    let payload: unknown = null;
    let file = '';
    const calls: string[] = [];
    const exec: Exec = async (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      if (args[1] === 'push') {
        file = args[4] as string;
        payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
      if (args.includes('list')) return { stdout: Buffer.from(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ udid: 'NEW-17', name: 'iPhone 17', state: 'Booted' }] } })), stderr: '' };
      return { stdout: Buffer.from(''), stderr: '' };
    };
    const p = new IosProvider({ app: { bundleId: 'com.example.todo' }, exec });
    await p.boot();
    await p.sendNotification({ title: 'Hello', body: 'World', data: { screen: 'system' } });
    expect(calls.at(-1)).toBe(`xcrun simctl push NEW-17 com.example.todo ${file}`);
    expect(payload).toEqual({ aps: { alert: { title: 'Hello', body: 'World' }, sound: 'default' }, screen: 'system' });
    expect(fs.existsSync(file)).toBe(false);
    await p.sendNotification({ title: 'Only a title' });
    expect(payload).toEqual({ aps: { alert: { title: 'Only a title' }, sound: 'default' } });
  });

  it('rotates through the app, and says why when it cannot', async () => {
    const { p } = provider([]);
    await p.boot();
    await p.setOrientation('landscape', inApp({ supported: true }));
    await expect(p.setOrientation('landscape', inApp({ supported: false }))).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
    await expect(p.setOrientation('landscape', inApp({ supported: true, error: 'unsupported orientation' }))).rejects.toThrow(/app\.json "orientation"/);
  });

  it('resets permissions with simctl privacy reset; notifications / camera (no service) only by reinstalling', async () => {
    const { p, calls } = provider([]);
    await p.boot();
    calls.length = 0;
    await expect(p.resetPermission('location')).resolves.toEqual({ relaunch: false });
    expect(calls).toContain('xcrun simctl privacy NEW-17 reset location com.example.todo');
    await expect(p.resetPermission('notifications')).resolves.toEqual({ relaunch: true, reinstall: true });
  });

  it('sets location, permissions, appearance and text size with simctl, and restores the previous values', async () => {
    const { p, calls } = provider([
      [/ui NEW-17 appearance$/, 'dark\n'],
      [/ui NEW-17 content_size$/, 'medium\n'],
    ]);
    await p.boot();
    calls.length = 0;
    await p.setLocation({ latitude: 35.68, longitude: 139.76 });
    await expect(p.setPermission('location', false)).resolves.toEqual({ relaunch: false });
    await expect(p.setPermission('camera', true)).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
    await p.setAppearance('light');
    await p.setAppearance('dark');
    await expect(p.setFontScale(1.25)).resolves.toEqual({ scale: 1.235, relaunch: false });
    expect(calls).toEqual([
      'xcrun simctl location NEW-17 set 35.68,139.76',
      'xcrun simctl privacy NEW-17 revoke location com.example.todo',
      'xcrun simctl ui NEW-17 appearance',
      'xcrun simctl ui NEW-17 appearance light',
      'xcrun simctl ui NEW-17 appearance dark',
      'xcrun simctl ui NEW-17 content_size',
      'xcrun simctl ui NEW-17 content_size extra-extra-large',
    ]);
    calls.length = 0;
    await expect(p.resetDeviceState(inApp({ supported: true }))).resolves.toEqual({ relaunch: false });
    expect(calls).toEqual(['xcrun simctl location NEW-17 clear', 'xcrun simctl ui NEW-17 appearance dark', 'xcrun simctl ui NEW-17 content_size medium']);
    calls.length = 0;
    await p.resetDeviceState(inApp({ supported: true }));
    expect(calls).toEqual([]);
  });

  it('applies a locale at launch (the app is started again), until reset', async () => {
    const { p, calls } = provider([]);
    await p.boot();
    await expect(p.setLocale('ja-JP')).resolves.toEqual({ relaunch: true });
    await expect(p.setLocale('ja-JP')).resolves.toEqual({ relaunch: false });
    await p.launch({ port: 1, sessionId: 's' });
    expect(calls.at(-1)).toBe('xcrun simctl launch --terminate-running-process NEW-17 com.example.todo -quiescoPort 1 -quiescoSession s -AppleLanguages (ja-JP) -AppleLocale ja_JP');
    await expect(p.resetDeviceState(inApp({ supported: true }))).resolves.toEqual({ relaunch: true });
    await p.launch({ port: 1, sessionId: 's' });
    expect(calls.at(-1)).not.toContain('AppleLanguages');
  });
});

describe('IosProvider artifacts (Phase 6.9)', () => {
  it('records video with simctl io recordVideo once it reports "Recording started"; SIGINT finishes it', async () => {
    const s = fakeSpawner((c) => c.stderr.emit('data', 'Recording started\n'));
    const { p } = provider([], { device: { device: 'iPhone 17', os: '27.0' }, spawnProcess: s.spawn });
    await p.boot();
    await p.startVideo('/tmp/a/video');
    expect(s.children[0]?.args).toEqual(['simctl', 'io', 'NEW-17', 'recordVideo', '--codec=h264', '--force', '/tmp/a/video.mp4']);
    expect(await p.stopVideo()).toEqual(['/tmp/a/video.mp4']);
    expect(s.children[0]?.signals).toEqual(['SIGINT']);
    expect(await p.stopVideo()).toEqual([]);
  });

  it('fails when the recorder exits instead of starting', async () => {
    const s = fakeSpawner((c) => {
      c.stderr.emit('data', 'No booted device');
      c.exit(1);
    });
    const { p } = provider([], { device: { device: 'iPhone 17', os: '27.0' }, spawnProcess: s.spawn });
    await p.boot();
    await expect(p.startVideo('/tmp/v')).rejects.toThrow(/recordVideo exited \(1\): No booted device/);
  });

  it('streams the app process log (its executable from simctl appinfo), without the header lines', async () => {
    const s = fakeSpawner();
    const { p } = provider([[/simctl appinfo NEW-17 com.example.todo/, '{\n    CFBundleExecutable = QuiescoTodo;\n}']], { device: { device: 'iPhone 17', os: '27.0' }, spawnProcess: s.spawn });
    await p.boot();
    const since = Date.now();
    await p.startDeviceLogs();
    await p.startDeviceLogs();
    expect(s.children).toHaveLength(1);
    expect(s.children[0]?.args.at(-1)).toBe('process == "QuiescoTodo" AND NOT subsystem BEGINSWITH "com.apple.Accessibility"');
    s.children[0]?.stdout.emit('data', 'Filtering the log data using "process == \\"QuiescoTodo\\""\nTimestamp  Ty Process\n2026 Df QuiescoTodo[1] hello\n');
    expect(p.deviceLogs(since)).toEqual(['2026 Df QuiescoTodo[1] hello']);
    await p.shutdown();
    expect(s.children[0]?.signals).toEqual(['SIGINT']);
  });
});
