import { describe, expect, it } from 'vitest';

import { main } from '../src/cli';
import { fakeContext } from './fake-context';

const SIMS = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
      { udid: 'BASE', name: 'iPhone 17', state: 'Booted' },
      { udid: 'W1', name: 'iPhone 17 (Quiesco 1)', state: 'Booted' },
    ],
    'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [{ udid: 'OLD-W1', name: 'iPhone 17 (Quiesco 1)', state: 'Shutdown' }],
  },
});

function devices() {
  return fakeContext(
    (command, args) => {
      const line = `${command} ${args.join(' ')}`;
      if (line === 'xcrun simctl list devices --json') return { stdout: SIMS };
      if (line === '/sdk/emulator/emulator -list-avds') return { stdout: 'Medium\nMedium_quiesco_1\nMedium_quiesco_2\n' };
      if (line === '/sdk/platform-tools/adb devices') return { stdout: 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n' };
      if (line.includes('emulator-5554 shell getprop')) return { stdout: 'Medium\n' };
      if (line.includes('emulator-5556 shell getprop')) return { stdout: 'Medium_quiesco_1\n' };
      return {};
    },
    { env: { ANDROID_HOME: '/sdk', HOME: '/home/u' } },
  );
}

describe('quiesco devices (Phase 6.12)', () => {
  it('lists only the worker simulators and AVDs Quiesco created', async () => {
    const ctx = devices();
    expect(await main(['devices'], ctx)).toBe(0);
    expect(ctx.lines.slice(1)).toEqual([
      '  ios     iPhone 17 (Quiesco 1) (iOS-27-0)  [running]',
      '  ios     iPhone 17 (Quiesco 1) (iOS-26-5)',
      '  android Medium_quiesco_1  [running]',
      '  android Medium_quiesco_2',
    ]);
    expect(ctx.calls.some((c) => c.args.includes('delete') || c.command === 'rm')).toBe(false);
  });

  it('--prune shuts them down and deletes them, never the base devices', async () => {
    const ctx = devices();
    expect(await main(['devices', '--prune'], ctx)).toBe(0);
    const lines = ctx.calls.map((c) => `${c.command} ${c.args.join(' ')}`);
    expect(lines).toContain('xcrun simctl shutdown W1');
    expect(lines).toContain('xcrun simctl delete W1');
    expect(lines).toContain('xcrun simctl delete OLD-W1');
    expect(lines).not.toContain('xcrun simctl shutdown OLD-W1');
    expect(lines).toContain('/sdk/platform-tools/adb -s emulator-5556 emu kill');
    expect(lines).toContain('rm -rf /home/u/.android/avd/Medium_quiesco_1.avd /home/u/.android/avd/Medium_quiesco_1.ini');
    expect(lines).toContain('rm -rf /home/u/.android/avd/Medium_quiesco_2.avd /home/u/.android/avd/Medium_quiesco_2.ini');
    expect(lines.some((l) => l.includes('BASE') || l.includes('emulator-5554 emu kill') || /avd\/Medium\.avd/.test(l))).toBe(false);
  });

  it('says so when there is nothing, and rejects unknown options', async () => {
    const none = fakeContext(() => ({}), { env: {} });
    expect(await main(['devices'], none)).toBe(0);
    expect(none.lines[0]).toMatch(/No devices created by Quiesco/);
    const bad = fakeContext();
    expect(await main(['devices', '--all'], bad)).toBe(2);
    expect(bad.errors[0]).toMatch(/unknown option "--all"/);
  });
});
