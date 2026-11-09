import { describe, expect, it } from 'vitest';

import { AndroidProvider, devClientLaunchUrl } from '../src/devices/android';
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
  [/dumpsys user/, 'Users:\n  UserInfo{0:Owner:c13} running\n    State: RUNNING_UNLOCKED\n'],
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
      'adb -s emulator-5554 shell dumpsys user',
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
    expect(spawned).toEqual(['emulator -avd New_AVD -no-boot-anim -no-snapshot-load -no-snapshot-save']);
    expect(adb.calls[0]).toBe('ps -ax -o command'); // checked that the AVD is not already running
    expect(adb.calls[1]).toBe('adb -s emulator-5560 shell getprop sys.boot_completed');
  });

  it('waits for the user to be unlocked and explains a user stuck in BOOTING', async () => {
    const { p } = provider(
      [[/adb devices$/, 'List of devices attached\nemulator-5554\tdevice\n'], [/getprop sys.boot_completed/, '1'], [/dumpsys user/, '    State: BOOTING\n']],
      { device: { bootTimeoutMs: 30 } },
    );
    await expect(p.boot()).rejects.toThrow(/not unlocked \(state BOOTING\).*adb -s emulator-5554 reboot/);
  });

  it('does not start a second emulator when the AVD process already runs but adb cannot name it', async () => {
    const spawned: string[] = [];
    const { p } = provider(
      [
        [/adb devices$/, 'List of devices attached\nemulator-5554\tdevice\n'],
        [/getprop ro.boot.qemu.avd_name|emu avd name/, ''],
        [/^ps /, '/sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64 -avd Pixel_API_37 -no-boot-anim\n'],
      ],
      { device: { avd: 'Pixel_API_37' }, spawn: (f, a) => spawned.push(`${f} ${a.join(' ')}`) },
    );
    await expect(p.boot()).rejects.toThrow(/already running.*devices\.android\.serial/);
    expect(spawned).toEqual([]);
  });

  it('fails clearly when the configured serial is missing or nothing runs', async () => {
    await expect(provider(BOOTED, { device: { serial: 'emulator-9999' } }).p.boot()).rejects.toThrow(/emulator-9999 is not connected/);
    await expect(provider([[/adb devices$/, 'List of devices attached\n']]).p.boot()).rejects.toThrow(/No Android device/);
  });

  it('launches a dev client with reverse ports, local-network grant, quoted URL and intent extras', async () => {
    const { p, calls } = provider(BOOTED, { app: { package: 'com.example.todo', devClient: { scheme: 'todo' }, reversePorts: [3001] } });
    await p.boot();
    calls.length = 0;
    await p.launch({ port: 7357, sessionId: 'abc-123' });
    expect(calls).toEqual([
      'adb -s emulator-5554 reverse tcp:7357 tcp:7357',
      'adb -s emulator-5554 reverse tcp:8081 tcp:8081',
      'adb -s emulator-5554 reverse tcp:3001 tcp:3001',
      "adb -s emulator-5554 shell pm grant 'com.example.todo' android.permission.ACCESS_LOCAL_NETWORK",
      "adb -s emulator-5554 shell am start -W -a android.intent.action.VIEW -d 'todo://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081&__expo_disable_onboarding=1&__expo_disable_fab=1&__expo_disable_auto_launch=1' --es quiescoPort 7357 --es quiescoSession 'abc-123' 'com.example.todo'",
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
    expect(a.calls.slice(-2)).toEqual(["adb -s emulator-5554 shell am force-stop 'p'", 'adb -s emulator-5554 install -r -g /tmp/app.apk']);
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

describe('AndroidProvider lifecycle (Phase 6.5)', () => {
  const booted = async (answers: [RegExp, string | Error][] = [], opts: Partial<AndroidProviderOptions> = {}) => {
    const r = provider([...BOOTED, ...answers], opts);
    await r.p.boot();
    r.calls.length = 0;
    return r;
  };

  it('passes launch arguments as one quoted base64 extra', async () => {
    const { p, calls } = await booted();
    await p.launch({ port: 7400, sessionId: 's', args: 'eyJhIjoxfQ==' });
    expect(calls.at(-1)).toBe("adb -s emulator-5554 shell am start -W -n 'com.example.todo/.MainActivity' --es quiescoPort 7400 --es quiescoSession 's' --es quiescoArgs 'eyJhIjoxfQ=='");
  });

  it('starts with a deep link: the intent data, or for dev clients the link with __expo_url', async () => {
    const standalone = await booted();
    await expect(standalone.p.launch({ port: 1, sessionId: 's', url: 'todo://todos/1' })).resolves.toBe('delivered');
    expect(standalone.calls.at(-1)).toBe("adb -s emulator-5554 shell am start -W -a android.intent.action.VIEW -d 'todo://todos/1' --es quiescoPort 1 --es quiescoSession 's' 'com.example.todo'");

    const dc = await booted([], { app: { package: 'com.example.todo', devClient: { scheme: 'todo', metroUrl: 'http://localhost:8083' } } });
    await dc.p.launch({ port: 1, sessionId: 's', url: 'todo://todos/1?tab=a#x' });
    expect(dc.calls.at(-1)).toContain(
      "-d 'todo://todos/1?tab=a&__expo_url=http%3A%2F%2Flocalhost%3A8083&__expo_disable_onboarding=1&__expo_disable_fab=1&__expo_disable_auto_launch=1#x'",
    );
  });

  it('builds dev-client launch URLs', () => {
    expect(devClientLaunchUrl('app://p', 'http://h:1')).toBe('app://p?__expo_url=http%3A%2F%2Fh%3A1&__expo_disable_onboarding=1&__expo_disable_fab=1&__expo_disable_auto_launch=1');
    expect(devClientLaunchUrl('app://p?', 'http://h:1')).toMatch(/^app:\/\/p\?__expo_url=/);
  });

  it('clears data, uninstalls, goes home and back, forwards ports', async () => {
    const { p, calls } = await booted([
      [/pm clear/, 'Success\n'],
      [/ uninstall /, 'Success\n'],
    ]);
    await p.clearData();
    await p.uninstall();
    await p.sendToBackground();
    await p.bringToForeground();
    await p.reversePort(3001);
    await p.unreversePort(3001);
    expect(calls).toEqual([
      "adb -s emulator-5554 shell pm clear 'com.example.todo'",
      'adb -s emulator-5554 uninstall com.example.todo',
      'adb -s emulator-5554 shell input keyevent KEYCODE_HOME',
      "adb -s emulator-5554 shell am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n 'com.example.todo/.MainActivity'",
      'adb -s emulator-5554 reverse tcp:3001 tcp:3001',
      'adb -s emulator-5554 reverse --remove tcp:3001',
    ]);
  });

  it('reports failed clear / uninstall', async () => {
    const { p } = await booted([[/pm clear/, 'Failed\n'], [/ uninstall /, new Error('DELETE_FAILED_INTERNAL_ERROR')]]);
    await expect(p.clearData()).rejects.toMatchObject({ errorName: 'DEVICE_ERROR' });
    await expect(p.uninstall()).rejects.toThrow(/DELETE_FAILED_INTERNAL_ERROR/);
  });
});

describe('AndroidProvider device state (Phase 6.6)', () => {
  const booted = async (answers: [RegExp, string | Error][] = []) => {
    const r = provider([...BOOTED, ...answers]);
    await r.p.boot();
    r.calls.length = 0;
    return r;
  };

  it('rotates, sets night mode, font scale and app locale, and restores what was there before', async () => {
    const { p, calls } = await booted([
      [/settings get system accelerometer_rotation/, '1\n'],
      [/settings get system user_rotation/, '0\n'],
      [/cmd uimode night$/, 'Night mode: auto\n'],
      [/settings get system font_scale/, 'null\n'],
    ]);
    await p.setOrientation('landscape');
    await p.setOrientation('portrait');
    await p.setAppearance('dark');
    // Both would recreate the activity: the app is started again.
    await expect(p.setFontScale(1.3)).resolves.toEqual({ scale: 1.3, relaunch: true });
    await expect(p.setLocale('ja-JP')).resolves.toEqual({ relaunch: true });
    const s = (c: string) => `adb -s emulator-5554 shell ${c}`;
    expect(calls).toEqual([
      s('settings get system accelerometer_rotation'),
      s('settings get system user_rotation'),
      s('settings put system accelerometer_rotation 0'),
      s('settings put system user_rotation 1'),
      s('settings put system accelerometer_rotation 0'),
      s('settings put system user_rotation 0'),
      s('cmd uimode night'),
      s('cmd uimode night yes'),
      s('settings get system font_scale'),
      s('settings put system font_scale 1.3'),
      s("cmd locale set-app-locales 'com.example.todo' --locales 'ja-JP'"),
    ]);
    calls.length = 0;
    await expect(p.resetDeviceState()).resolves.toEqual({ relaunch: true });
    expect(calls).toEqual([
      s('settings put system accelerometer_rotation 1'),
      s('settings put system user_rotation 0'),
      s('cmd uimode night auto'),
      s('settings put system font_scale 1.0'),
      s("cmd locale set-app-locales 'com.example.todo' --locales ''"),
    ]);
    // Only rotation / night mode changed: restored live, no restart.
    await p.setOrientation('landscape');
    await expect(p.resetDeviceState()).resolves.toEqual({ relaunch: false });
  });

  it('grants and revokes (a revoke kills the app), and fakes the location on emulators only', async () => {
    const { p, calls } = await booted();
    await expect(p.setPermission('location', true)).resolves.toEqual({ relaunch: false });
    await expect(p.setPermission('location', false)).resolves.toEqual({ relaunch: true });
    await p.setLocation({ latitude: 35.68, longitude: 139.76 });
    expect(calls).toEqual([
      "adb -s emulator-5554 shell pm grant 'com.example.todo' android.permission.ACCESS_FINE_LOCATION",
      "adb -s emulator-5554 shell pm grant 'com.example.todo' android.permission.ACCESS_COARSE_LOCATION",
      "adb -s emulator-5554 shell pm revoke 'com.example.todo' android.permission.ACCESS_FINE_LOCATION",
      "adb -s emulator-5554 shell pm revoke 'com.example.todo' android.permission.ACCESS_COARSE_LOCATION",
      'adb -s emulator-5554 emu geo fix 139.76 35.68',
    ]);
    const device = provider([[/adb devices$/, 'List of devices attached\nR58M123\tdevice\n'], ...BOOTED.slice(2)], { device: { serial: 'R58M123' } });
    await device.p.boot();
    await expect(device.p.setLocation({ latitude: 1, longitude: 2 })).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
  });

  it('reports a permission the app does not declare', async () => {
    const { p } = await booted([[/pm grant .* android.permission.CAMERA/, 'Exception occurred: has not requested permission android.permission.CAMERA']]);
    await expect(p.setPermission('camera', true)).rejects.toThrow(/declared in the app manifest/);
  });
});
