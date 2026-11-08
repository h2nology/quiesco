import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Exec } from '../src/devices/exec';
import { IOS_DEV_MENU_ARGS, IOS_RESTRICTION_FILES, IosProvider, chooseSimulator, runtimeMatches } from '../src/devices/ios';
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
      '-EXDevMenuShowsAtLaunch', 'NO', '-EXDevMenuIsOnboardingFinished', 'YES', '-EXDevMenuShowFloatingActionButton', 'NO', '-EXDevMenuDisableAutoLaunch', 'YES',
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
