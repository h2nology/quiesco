import { describe, expect, it } from 'vitest';

import { AndroidProvider } from '../src/devices/android';
import type { AndroidProviderOptions } from '../src/devices/android';
import type { Exec } from '../src/devices/exec';
import { shq } from '../src/devices/exec';

/** Fake adb: answers by matching the joined command line. */
function fakeAdb(answers: [RegExp, string | Error][] = []) {
  const calls: string[] = [];
  const exec: Exec = async (file, args) => {
    const line = `${file} ${args.join(' ')}`;
    calls.push(line);
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

const BOOTED: [RegExp, string][] = [
  [/adb devices$/, 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\n'],
  [/getprop ro.boot.qemu.avd_name/, 'Pixel_API_37\n'],
  [/getprop sys.boot_completed/, '1\n'],
];

function provider(answers: [RegExp, string | Error][], opts: Partial<AndroidProviderOptions> = {}) {
  const adb = fakeAdb(answers);
  const p = new AndroidProvider({ app: { package: 'com.example.todo' }, adbPath: 'adb', emulatorPath: 'emulator', exec: adb.exec, pollMs: 1, ...opts });
  return { p, calls: adb.calls };
}

describe('shq', () => {
  it('single-quotes for the device shell', () => {
    expect(shq("it's & more")).toBe(`'it'\\''s & more'`);
  });
});

describe('AndroidProvider', () => {
  it('attaches to the running emulator of the configured AVD, wakes it and keeps it on', async () => {
    const { p, calls } = provider(BOOTED, { device: { avd: 'Pixel_API_37' } });
    await p.boot();
    expect(calls).toEqual([
      'adb devices',
      'adb -s emulator-5554 shell getprop ro.boot.qemu.avd_name',
      'adb -s emulator-5554 shell getprop sys.boot_completed',
      'adb -s emulator-5554 shell input keyevent KEYCODE_WAKEUP',
      'adb -s emulator-5554 shell svc power stayon true',
      'adb -s emulator-5554 shell wm dismiss-keyguard',
    ]);
  });

  it('falls back to `emu avd name` when the property is empty', async () => {
    const { p, calls } = provider([[/adb devices$/, BOOTED[0]![1]], [/emu avd name/, 'Pixel_API_37\nOK\n'], [/getprop sys.boot_completed/, '1']], { device: { avd: 'Pixel_API_37' } });
    await p.boot();
    expect(calls.slice(1, 3)).toEqual(['adb -s emulator-5554 shell getprop ro.boot.qemu.avd_name', 'adb -s emulator-5554 emu avd name']);
    expect(calls).not.toContainEqual(expect.stringMatching(/^emulator /));
  });

  it('boots the AVD when it is not running and waits for it', async () => {
    let n = 0;
    const spawned: string[] = [];
    const adb = fakeAdb([[/getprop sys.boot_completed/, '1']]);
    const exec: Exec = async (file, args, o) => {
      if (args.join(' ') === 'devices') {
        n++;
        return { stdout: Buffer.from(`List of devices attached\n${n >= 3 ? 'emulator-5560\tdevice\n' : ''}`), stderr: '' };
      }
      return adb.exec(file, args, o);
    };
    const p = new AndroidProvider({ app: { package: 'x' }, device: { avd: 'New_AVD' }, adbPath: 'adb', emulatorPath: 'emulator', exec, spawn: (f, a) => spawned.push(`${f} ${a.join(' ')}`), pollMs: 1 });
    await p.boot();
    expect(spawned).toEqual(['emulator -avd New_AVD -no-boot-anim -no-snapshot-save']);
    expect(adb.calls[0]).toBe('adb -s emulator-5560 shell getprop sys.boot_completed');
  });

  it('fails clearly when the configured serial is missing or nothing runs', async () => {
    await expect(provider(BOOTED, { device: { serial: 'emulator-9999' } }).p.boot()).rejects.toThrow(/emulator-9999 is not connected/);
    await expect(provider([[/adb devices$/, 'List of devices attached\n']]).p.boot()).rejects.toThrow(/No Android device/);
  });

  it('launches a dev client with reverse ports, local-network grant, quoted URL and intent extras', async () => {
    const { p, calls } = provider(BOOTED, { app: { package: 'com.example.todo', devClient: { scheme: 'todo' } } });
    await p.boot();
    calls.length = 0;
    await p.launch({ port: 7357, sessionId: 'abc-123' });
    expect(calls).toEqual([
      'adb -s emulator-5554 reverse tcp:7357 tcp:7357',
      'adb -s emulator-5554 reverse tcp:8081 tcp:8081',
      "adb -s emulator-5554 shell pm grant 'com.example.todo' android.permission.ACCESS_LOCAL_NETWORK",
      "adb -s emulator-5554 shell am start -W -a android.intent.action.VIEW -d 'todo://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081&__expo_disable_onboarding=1&__expo_disable_fab=1' --es quiescoPort 7357 --es quiescoSession 'abc-123' 'com.example.todo'",
    ]);
  });

  it('launches a standalone build by activity and ignores a failing local-network grant', async () => {
    const { p, calls } = provider([...BOOTED, [/ACCESS_LOCAL_NETWORK/, new Error('Unknown permission')]]);
    await p.boot();
    calls.length = 0;
    await p.launch({ port: 7400, sessionId: 's' });
    expect(calls.at(-1)).toBe("adb -s emulator-5554 shell am start -W -n 'com.example.todo/.MainActivity' --es quiescoPort 7400 --es quiescoSession 's'");
  });

  it('maps permissions and warns about failures', async () => {
    const warnings: string[] = [];
    const { p, calls } = provider([...BOOTED, [/READ_CONTACTS/, new Error('not declared')]], {
      logger: { debug() {}, info() {}, warn: (m) => warnings.push(m), error() {} },
    });
    await p.boot();
    calls.length = 0;
    await p.grantPermissions(['camera', 'contacts', 'teleport' as never]);
    expect(calls).toEqual([
      "adb -s emulator-5554 shell pm grant 'com.example.todo' android.permission.CAMERA",
      "adb -s emulator-5554 shell pm grant 'com.example.todo' android.permission.READ_CONTACTS",
    ]);
    expect(warnings).toEqual([expect.stringMatching(/cannot grant android.permission.READ_CONTACTS/), 'permission "teleport" is not supported on Android; skipped']);
  });

  it('installs an APK, or checks that the package exists', async () => {
    const a = provider(BOOTED, { app: { package: 'p', binaryPath: '/tmp/app.apk' } });
    await a.p.boot();
    await a.p.install();
    expect(a.calls.at(-1)).toBe('adb -s emulator-5554 install -r -g /tmp/app.apk');
    const b = provider(BOOTED);
    await b.p.boot();
    await expect(b.p.install()).rejects.toThrow(/com.example.todo is not installed/);
  });

  it('injects back and navigate, terminates, screenshots, diagnoses', async () => {
    const { p, calls } = provider([...BOOTED, [/screencap/, 'PNGDATA'], [/reverse --list/, 'emulator-5554 tcp:8081 tcp:8081\n'], [/pidof/, '']]);
    await p.boot();
    calls.length = 0;
    await p.injectInput({ kind: 'back' });
    await p.injectInput({ kind: 'navigate', url: 'todo://todos/1' });
    await p.terminate();
    expect((await p.screenshot()).toString()).toBe('PNGDATA');
    expect(calls).toEqual([
      'adb -s emulator-5554 shell input keyevent KEYCODE_BACK',
      "adb -s emulator-5554 shell am start -W -a android.intent.action.VIEW -d 'todo://todos/1' 'com.example.todo'",
      "adb -s emulator-5554 shell am force-stop 'com.example.todo'",
      'adb -s emulator-5554 exec-out screencap -p',
    ]);
    await expect(p.injectInput({ kind: 'tap', x: 1, y: 2 })).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
    expect(await p.diagnose({ port: 7357, sessionId: 's' })).toEqual([
      expect.stringMatching(/adb reverse for tcp:7357 is MISSING/),
      expect.stringMatching(/com.example.todo is NOT running/),
    ]);
  });
});
