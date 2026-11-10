import { describe, expect, it } from 'vitest';

import { AndroidProvider, devClientLaunchUrl, parseUiNodes, primaryButton } from '../src/devices/android';
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

  it('grants and revokes (a revoke kills the app, and the app may ask again), and fakes the location on emulators only', async () => {
    const { p, calls } = await booted();
    await expect(p.setPermission('location', true)).resolves.toEqual({ relaunch: false });
    await expect(p.setPermission('location', false)).resolves.toEqual({ relaunch: true });
    await p.setLocation({ latitude: 35.68, longitude: 139.76 });
    expect(calls).toEqual([
      "adb -s emulator-5554 shell pm grant 'com.example.todo' android.permission.ACCESS_FINE_LOCATION",
      "adb -s emulator-5554 shell pm grant 'com.example.todo' android.permission.ACCESS_COARSE_LOCATION",
      "adb -s emulator-5554 shell pm revoke 'com.example.todo' android.permission.ACCESS_FINE_LOCATION",
      "adb -s emulator-5554 shell pm clear-permission-flags 'com.example.todo' android.permission.ACCESS_FINE_LOCATION user-set user-fixed",
      "adb -s emulator-5554 shell pm revoke 'com.example.todo' android.permission.ACCESS_COARSE_LOCATION",
      "adb -s emulator-5554 shell pm clear-permission-flags 'com.example.todo' android.permission.ACCESS_COARSE_LOCATION user-set user-fixed",
      'adb -s emulator-5554 emu geo fix 139.76 35.68',
    ]);
    const device = provider([[/adb devices$/, 'List of devices attached\nR58M123\tdevice\n'], ...BOOTED.slice(2)], { device: { serial: 'R58M123' } });
    await device.p.boot();
    await expect(device.p.setLocation({ latitude: 1, longitude: 2 })).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
  });

  it('status bar: demo mode entered once (notifications hidden), one broadcast per option, restored on reset', async () => {
    const { p, calls } = await booted([
      [/settings get global sysui_demo_allowed/, 'null\n'],
      [/am broadcast/, 'Broadcasting: Intent { act=com.android.systemui.demo flg=0x400000 (has extras) }\nBroadcast completed: result=0\n'],
    ]);
    await p.setStatusBar({ time: '9:41', batteryLevel: 100, charging: false, wifiBars: 3, cellularBars: 2, dataNetwork: 'lte' });
    await p.setStatusBar({ dataNetwork: 'hide' });
    const s = (c: string) => `adb -s emulator-5554 shell ${c}`;
    const demo = (c: string) => s(`am broadcast -a com.android.systemui.demo -e command ${c}`);
    expect(calls).toEqual([
      s('settings get global sysui_demo_allowed'),
      s('settings put global sysui_demo_allowed 1'),
      demo('enter'),
      demo("notifications -e visible 'false'"),
      demo("clock -e hhmm '0941'"),
      demo("battery -e level '100' -e plugged 'false'"),
      demo("network -e wifi 'show' -e level '4'"),
      demo("network -e mobile 'show' -e level '2' -e datatype 'lte'"),
      demo("network -e mobile 'hide'"),
    ]);
    calls.length = 0;
    await expect(p.resetDeviceState()).resolves.toEqual({ relaunch: false });
    expect(calls).toEqual([demo('exit'), s('settings put global sysui_demo_allowed 0')]);
    calls.length = 0;
    await p.resetStatusBar();
    expect(calls).toEqual([]);
  });

  it('a failed demo broadcast is reported', async () => {
    const { p } = await booted([[/am broadcast/, 'Error: no receiver\n']]);
    await expect(p.setStatusBar({ time: '10:30' })).rejects.toThrow(/demo mode \(enter\) failed/);
  });

  it('offline: Wi-Fi and mobile data off with svc, restored to what they were', async () => {
    const { p, calls } = await booted([
      [/settings get global wifi_on/, '1\n'],
      [/settings get global mobile_data/, '0\n'],
    ]);
    await p.setNetwork(true);
    await p.setNetwork(false);
    await p.setNetwork(true);
    const s = (c: string) => `adb -s emulator-5554 shell ${c}`;
    expect(calls).toEqual([
      s('settings get global wifi_on'),
      s('settings get global mobile_data'),
      s('svc wifi disable'),
      s('svc data disable'),
      s('svc wifi enable'),
      s('svc data enable'),
      s('svc wifi disable'),
      s('svc data disable'),
    ]);
    calls.length = 0;
    await p.resetDeviceState();
    expect(calls).toEqual([s('svc wifi enable'), s('svc data disable')]);
  });

  it('clipboard goes through the app; without @quiesco/native it is not supported', async () => {
    const { p, calls } = await booted();
    let clip = 'x';
    const app = {
      suspend: async () => false,
      setOrientation: async () => ({ supported: false }),
      getClipboard: async () => ({ supported: true, text: clip }),
      setClipboard: async (t: string) => {
        clip = t;
        return { supported: true };
      },
      postNotification: async () => ({ supported: false }),
    };
    await p.setClipboard('hello', app);
    await expect(p.getClipboard(app)).resolves.toBe('hello');
    expect(calls).toEqual([]);
    const without = { ...app, getClipboard: async () => ({ supported: false }), setClipboard: async () => ({ supported: false }) };
    await expect(p.setClipboard('x', without)).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', data: { action: 'clipboard.set', platform: 'android' } });
    await expect(p.getClipboard(without)).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
  });

  it('reports a permission the app does not declare', async () => {
    const { p } = await booted([[/pm grant .* android.permission.CAMERA/, 'Exception occurred: has not requested permission android.permission.CAMERA']]);
    await expect(p.setPermission('camera', true)).rejects.toThrow(/declared in the app manifest/);
  });
});

describe('AndroidProvider system integration (Phase 6.7)', () => {
  const screen = (...nodes: string[]) => `<hierarchy><node text="" resource-id="" clickable="false" enabled="true" bounds="[0,0][1080,2400]">${nodes.join('')}</node></hierarchy>`;
  const PIN_SCREEN = screen('<node text="" resource-id="com.android.settings:id/password_entry" clickable="true" enabled="true" bounds="[267,914][813,1054]" />');
  const CONSENT = screen('<node text="NO THANKS" resource-id="" clickable="true" enabled="true" bounds="[53,2179][343,2305]" />', '<node text="I AGREE" resource-id="" clickable="true" enabled="true" bounds="[796,2179][1027,2305]" />');
  const TOUCH = screen('<node text="Touch the sensor" resource-id="com.android.settings:id/suc_layout_title" clickable="false" enabled="true" bounds="[63,336][1017,421]" />', '<node text="DO IT LATER" resource-id="" clickable="true" enabled="true" bounds="[21,2179][315,2305]" />');

  /** An emulator whose Settings walks PIN → consent → three sensor touches → enrolled. */
  function enrollingEmulator() {
    const calls: string[] = [];
    let ui = PIN_SCREEN;
    let touches = 0;
    let prints = 0;
    const exec: Exec = async (file, args) => {
      const line = `${file} ${args.join(' ')}`;
      calls.push(line);
      let out = '';
      for (const [re, answer] of BOOTED) if (re.test(line)) out = answer;
      if (/locksettings set-pin/.test(line)) out = "Pin set to '7357'\n";
      if (/locksettings clear/.test(line)) prints = 0;
      if (/dumpsys fingerprint/.test(line)) out = `{"prints":[{"id":0,"count":${prints}}]}`;
      if (/cat \/sdcard\/quiesco-ui.xml/.test(line)) out = ui;
      if (/KEYCODE_ENTER/.test(line)) ui = CONSENT;
      if (/input tap 911 2242/.test(line)) ui = TOUCH;
      if (/emu finger touch 1/.test(line) && ui === TOUCH && ++touches === 3) prints = 1;
      return { stdout: Buffer.from(out), stderr: '' };
    };
    const p = new AndroidProvider({ app: { package: 'com.example.todo' }, adbPath: 'adb', emulatorPath: 'emulator', exec, pollMs: 1 });
    return { p, calls };
  }

  it('finds Settings’ primary footer button by position (not by its localized text)', () => {
    expect(primaryButton(parseUiNodes(CONSENT))).toEqual({ x: 911, y: 2242 });
    expect(primaryButton(parseUiNodes(TOUCH))).toBeNull(); // only "Do it later" (left): touch the sensor instead
    expect(primaryButton(parseUiNodes(PIN_SCREEN))).toBeNull();
    expect(parseUiNodes(TOUCH)[1]).toMatchObject({ text: 'Touch the sensor', resourceId: 'com.android.settings:id/suc_layout_title', clickable: false });
  });

  it('enrolls through Settings with a PIN it removes again (with the fingerprints) on reset', async () => {
    const { p, calls } = enrollingEmulator();
    await p.boot();
    calls.length = 0;
    await expect(p.setBiometricEnrollment(true)).resolves.toEqual({ leftApp: true });
    const s = (c: string) => `adb -s emulator-5554 shell ${c}`;
    const steps = calls.filter((c) => !/dumpsys fingerprint|uiautomator dump|cat \/sdcard/.test(c));
    expect(steps).toEqual([
      s('locksettings set-pin 7357'),
      s('am start -W -a android.settings.FINGERPRINT_ENROLL'),
      s('input text 7357'),
      s('input keyevent KEYCODE_ENTER'),
      s('input tap 911 2242'),
      'adb -s emulator-5554 emu finger touch 1',
      'adb -s emulator-5554 emu finger touch 1',
      'adb -s emulator-5554 emu finger touch 1',
      s('am force-stop com.android.settings'),
    ]);
    // Already enrolled: nothing to do.
    calls.length = 0;
    await expect(p.setBiometricEnrollment(true)).resolves.toEqual({ leftApp: false });
    expect(calls.filter((c) => !/dumpsys fingerprint/.test(c))).toEqual([]);
    calls.length = 0;
    await p.resetDeviceState();
    expect(calls).toContain(s('locksettings clear --old 7357'));
  });

  it('enroll(false) removes Quiesco’s PIN; a PIN it cannot set is reported', async () => {
    const { p, calls } = enrollingEmulator();
    await p.boot();
    await p.setBiometricEnrollment(true);
    calls.length = 0;
    await expect(p.setBiometricEnrollment(false)).resolves.toEqual({ leftApp: false });
    expect(calls).toEqual(['adb -s emulator-5554 shell locksettings clear --old 7357']);
    const locked = provider([...BOOTED, [/locksettings set-pin/, 'Old password provided is not correct\n'], [/dumpsys fingerprint/, '"count":0']]);
    await locked.p.boot();
    await expect(locked.p.setBiometricEnrollment(true)).rejects.toThrow(/already have a screen lock/);
  });

  it('waits for the authentication to start before touching the sensor; says so when none is waiting', async () => {
    let polls = 0;
    const calls: string[] = [];
    const exec: Exec = async (file, args) => {
      const line = `${file} ${args.join(' ')}`;
      calls.push(line);
      let out = '';
      for (const [re, answer] of BOOTED) if (re.test(line)) out = answer;
      // Queued (state 4) for two polls, then started (state 2).
      if (/dumpsys fingerprint/.test(line)) out = `Current operation: {FingerprintAuthenticationClient}, State: ${++polls > 2 ? 2 : 4}`;
      return { stdout: Buffer.from(out), stderr: '' };
    };
    const p = new AndroidProvider({ app: { package: 'com.example.todo' }, adbPath: 'adb', emulatorPath: 'emulator', exec, pollMs: 1 });
    await p.boot();
    calls.length = 0;
    await p.presentBiometric(true);
    expect(calls.filter((c) => /dumpsys fingerprint/.test(c))).toHaveLength(3);
    expect(calls.at(-1)).toBe('adb -s emulator-5554 emu finger touch 1');
    const idle = provider([...BOOTED, [/dumpsys fingerprint/, 'Current operation: null']]);
    await idle.p.boot();
    await expect(idle.p.presentBiometric(false)).rejects.toThrow(/no fingerprint authentication is waiting/);
  }, 15_000);

  it('presents finger 1 (enrolled) or 2 (unknown), shakes with alternating accelerometer pushes; emulators only', async () => {
    const started = 'Current operation: {[57] com.android.server.biometrics.sensors.fingerprint.aidl.FingerprintAuthenticationClient, owner=com.example.todo}, State: 2';
    const { p, calls } = provider([...BOOTED, [/dumpsys fingerprint/, started]]);
    await p.boot();
    calls.length = 0;
    await p.presentBiometric(true);
    await p.presentBiometric(false);
    await p.shake();
    const touches = calls.filter((c) => !/dumpsys fingerprint/.test(c));
    expect(touches.slice(0, 2)).toEqual(['adb -s emulator-5554 emu finger touch 1', 'adb -s emulator-5554 emu finger touch 2']);
    const pushes = touches.slice(2);
    expect(pushes).toHaveLength(13);
    expect(pushes[0]).toBe('adb -s emulator-5554 emu sensor set acceleration 20:9.8:0');
    expect(pushes[1]).toBe('adb -s emulator-5554 emu sensor set acceleration -20:9.8:0');
    expect(pushes[12]).toBe('adb -s emulator-5554 emu sensor set acceleration 0:9.81:0');
    const device = provider([[/adb devices$/, 'List of devices attached\nR58M123\tdevice\n'], ...BOOTED.slice(2)], { device: { serial: 'R58M123' } });
    await device.p.boot();
    await expect(device.p.shake()).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', data: { action: 'shake' } });
    await expect(device.p.presentBiometric(true)).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED' });
  });

  it('sends notifications through the app; says what is missing when it cannot', async () => {
    const { p, calls } = provider(BOOTED);
    await p.boot();
    calls.length = 0;
    const posted: unknown[] = [];
    const app = (r: { supported: boolean; enabled?: boolean }) => ({
      suspend: async () => false,
      setOrientation: async () => ({ supported: false }),
      getClipboard: async () => ({ supported: false }),
      setClipboard: async () => ({ supported: false }),
      postNotification: async (n: unknown) => {
        posted.push(n);
        return r;
      },
    });
    await p.sendNotification({ title: 'Hello', data: { screen: 'system' } }, app({ supported: true, enabled: true }));
    expect(posted).toEqual([{ title: 'Hello', data: { screen: 'system' } }]);
    expect(calls).toEqual([]);
    await expect(p.sendNotification({ title: 'x' }, app({ supported: false }))).rejects.toMatchObject({ errorName: 'ACTION_NOT_SUPPORTED', data: { action: 'sendNotification' } });
    await expect(p.sendNotification({ title: 'x' }, app({ supported: true, enabled: false }))).rejects.toThrow(/grant them/);
  });

  it('opens a notification from the shade by its title; lists what is there when it is missing', async () => {
    const shade = '<hierarchy><node text="" resource-id="" clickable="false" enabled="true" bounds="[0,0][1080,2400]"><node text="Quiesco Todo" resource-id="android:id/app_name_text" clickable="false" enabled="true" bounds="[200,300][500,350]" /><node text="Hello" resource-id="android:id/title" clickable="false" enabled="true" bounds="[200,360][600,420]" /></node></hierarchy>';
    const { p, calls } = provider([...BOOTED, [/cat \/sdcard\/quiesco-ui.xml/, shade]]);
    await p.boot();
    calls.length = 0;
    await p.openNotification('Hello');
    expect(calls.filter((c) => !/uiautomator dump|cat \/sdcard/.test(c))).toEqual([
      'adb -s emulator-5554 shell cmd statusbar expand-notifications',
      'adb -s emulator-5554 shell input tap 400 390',
    ]);
    calls.length = 0;
    await expect(p.openNotification('Missing')).rejects.toThrow(/no notification "Missing" in the shade \(texts there: "Quiesco Todo", "Hello"\)/);
    expect(calls.at(-1)).toBe('adb -s emulator-5554 shell cmd statusbar collapse');
  }, 15_000);

  it('lists the system UI outside the app (uiautomator) and taps a node at its center', async () => {
    const DIALOG = [
      '<hierarchy>',
      '<node text="" resource-id="" package="com.example.todo" enabled="true" bounds="[0,0][1080,2400]" />',
      '<node text="Allow Todo to send you notifications?" resource-id="com.android.permissioncontroller:id/permission_message" package="com.google.android.permissioncontroller" enabled="true" bounds="[133,1010][947,1179]" />',
      '<node text="Allow" resource-id="com.android.permissioncontroller:id/permission_allow_button" package="com.google.android.permissioncontroller" clickable="true" enabled="true" bounds="[133,1242][947,1368]" />',
      '<node text="" resource-id="" package="com.google.android.permissioncontroller" enabled="true" bounds="[28,789][1052,1610]" />',
      '<node text="Off" resource-id="x:id/off" package="com.google.android.permissioncontroller" enabled="false" bounds="[0,0][1,1]" />',
      '<node text="Todo item" resource-id="" package="com.example.todo" enabled="true" bounds="[0,0][10,10]" />',
      '</hierarchy>',
    ].join('');
    const { p, calls } = provider([...BOOTED, [/cat \/sdcard\/quiesco-ui.xml/, DIALOG]]);
    await p.boot();
    const nodes = await p.systemNodes();
    // Not the app's own nodes, not disabled ones, not anonymous containers.
    expect(nodes).toEqual([
      { text: 'Allow Todo to send you notifications?', id: 'com.android.permissioncontroller:id/permission_message', bounds: { x1: 133, y1: 1010, x2: 947, y2: 1179 } },
      { text: 'Allow', id: 'com.android.permissioncontroller:id/permission_allow_button', bounds: { x1: 133, y1: 1242, x2: 947, y2: 1368 } },
    ]);
    calls.length = 0;
    await p.tapSystemNode(nodes[1]!);
    expect(calls).toEqual(['adb -s emulator-5554 shell input tap 540 1305']);
    expect(p.permissionDialog.deny).toContain('com.android.permissioncontroller:id/permission_deny_and_dont_ask_again_button');
  });
});
