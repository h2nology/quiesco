/** Phase 6.12: one device, port and artifacts directory per parallel worker. */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, resolveConfig, serverPort, toAgentConfig } from '../src/config';
import type { QuiescoConfig } from '../src/config';
import { AndroidProvider, workerAvdConfig, workerAvdName } from '../src/devices/android';
import { IosProvider, chooseSimulator, workerSimulatorName } from '../src/devices/ios';
import type { SimDevice } from '../src/devices/ios';
import type { Exec } from '../src/devices/exec';
import { killChildProcessesSync, trackChildProcess } from '../src/devices/streams';
import { workerSuffix } from '../src/artifacts';
import { Lifecycle } from '../src/lifecycle';
import type { Session, SessionOptions } from '../src/session';
import { launchConnectTimeout } from '../src/session';

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'quiesco-parallel-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Fake command runner: answers by matching the joined command line; `answers` may be a function of the calls so far. */
function fakeExec(answer: (line: string) => string | Error | undefined) {
  const calls: string[] = [];
  const exec: Exec = async (file, args) => {
    const line = `${file} ${args.join(' ')}`;
    calls.push(line);
    const out = line.endsWith('shell pm path android') ? 'package:/system/framework/framework-res.apk\n' : answer(line);
    if (out instanceof Error) throw out;
    return { stdout: Buffer.from(out ?? ''), stderr: '' };
  };
  return { exec, calls };
}

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

// ---------------------------------------------------------------- config

describe('per-worker config', () => {
  it('evaluates a config function with the worker; objects pass through', () => {
    const fn = ({ workerIndex }: { workerIndex: number }): QuiescoConfig => ({ apps: { android: { package: 'x', reversePorts: [3001 + workerIndex] } } });
    expect(resolveConfig(fn, { workerIndex: 2, workerCount: 3 }).apps.android?.reversePorts).toEqual([3003]);
    const obj: QuiescoConfig = { apps: {} };
    expect(resolveConfig(obj, { workerIndex: 1, workerCount: 2 })).toBe(obj);
  });

  it('loads a config file exporting a function, per worker', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'quiesco.config.mjs'), 'export default ({ workerIndex, workerCount }) => ({ apps: {}, launchArgs: { api: 3001 + workerIndex, of: workerCount } });\n');
    expect((await loadConfig({ cwd: dir, worker: { workerIndex: 1, workerCount: 2 } })).config.launchArgs).toEqual({ api: 3002, of: 2 });
    expect((await loadConfig({ cwd: dir })).config.launchArgs).toEqual({ api: 3001, of: 1 });
  });

  it('rejects a config function that returns nothing', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'quiesco.config.mjs'), 'export default () => undefined;\n');
    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/must return the config object/);
  });

  it('gives worker N the port server.port + N and tells the agent its index', () => {
    expect(serverPort({ apps: {} })).toBe(7357);
    expect(serverPort({ apps: {}, server: { port: 9000 } }, 2)).toBe(9002);
    expect(toAgentConfig({ apps: {} }, undefined, 3).workerIndex).toBe(3);
    expect(toAgentConfig({ apps: {} }).workerIndex).toBe(0);
  });

  it('names artifacts run directories per worker only when running in parallel', () => {
    expect(workerSuffix(undefined)).toBe('');
    expect(workerSuffix({ index: 0, count: 1 })).toBe('');
    expect(workerSuffix({ index: 0, count: 2 })).toBe('-w0');
    expect(workerSuffix({ index: 3, count: 4 })).toBe('-w3');
  });
});

describe('Lifecycle with a worker', () => {
  it('evaluates the config for its worker and passes the worker to the session', async () => {
    const dir = tmp();
    const file = path.join(dir, 'quiesco.config.mjs');
    fs.writeFileSync(file, 'export default ({ workerIndex }) => ({ apps: {}, launchArgs: { w: workerIndex } });\n');
    let seen: SessionOptions | null = null;
    const l = new Lifecycle({
      platform: 'web',
      env: { QUIESCO_CONFIG: file },
      worker: { index: 1, count: 2 },
      createSession: async (o) => {
        seen = o;
        return { dispose: async () => undefined } as unknown as Session;
      },
    });
    await l.beforeAll();
    expect(seen).not.toBeNull();
    expect(seen!.worker).toEqual({ index: 1, count: 2 });
    expect(seen!.config.launchArgs).toEqual({ w: 1 });
    await l.afterAll();
  });
});

// ---------------------------------------------------------------- iOS

const R27 = 'com.apple.CoreSimulator.SimRuntime.iOS-27-0';
const R265 = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
const T17 = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17';
const TAIR = 'com.apple.CoreSimulator.SimDeviceType.iPhone-Air';

function simList(devices: Record<string, { udid: string; name: string; state: string; deviceTypeIdentifier?: string; dataPath?: string }[]>): string {
  return JSON.stringify({ devices });
}

describe('iOS worker simulators', () => {
  const BASE = { udid: 'NEW-17', name: 'iPhone 17', state: 'Booted', deviceTypeIdentifier: T17 };

  it('never picks a worker simulator as the default (only by udid)', () => {
    const devices: SimDevice[] = [
      { udid: 'W1', name: 'iPhone 17 (Quiesco 1)', state: 'Booted', runtime: R27 },
      { udid: 'NEW-17', name: 'iPhone 17', state: 'Booted', runtime: R27 },
    ];
    expect(chooseSimulator(devices, {}).udid).toBe('NEW-17');
    expect(chooseSimulator(devices, { udid: 'W1' }).udid).toBe('W1');
    expect(workerSimulatorName('iPhone 17', 2)).toBe('iPhone 17 (Quiesco 2)');
  });

  it('worker 0 uses the base; worker N creates "<name> (Quiesco N)" with the base device type and runtime', async () => {
    let created = false;
    const x = fakeExec((line) => {
      if (line.includes('list devices available --json')) {
        return simList({ [R27]: [BASE, ...(created ? [{ udid: 'W1', name: 'iPhone 17 (Quiesco 1)', state: 'Shutdown', deviceTypeIdentifier: T17 }] : [])] });
      }
      if (line.includes('simctl create')) {
        created = true;
        return 'W1\n';
      }
      return undefined;
    });
    const w0 = new IosProvider({ app: { bundleId: 'b' }, device: { device: 'iPhone 17' }, exec: x.exec, logger: quiet, worker: { index: 0, count: 2 } });
    await w0.boot();
    expect(x.calls.some((c) => c.includes('create'))).toBe(false);

    const w1 = new IosProvider({ app: { bundleId: 'b' }, device: { device: 'iPhone 17' }, exec: x.exec, logger: quiet, worker: { index: 1, count: 2 } });
    await w1.boot();
    expect(x.calls).toContain(`xcrun simctl create iPhone 17 (Quiesco 1) ${T17} ${R27}`);
    expect(x.calls).toContain('xcrun simctl boot W1');
  });

  it('reuses a worker simulator only with the same runtime and device type', async () => {
    const x = fakeExec((line) => {
      if (line.includes('list devices available --json')) {
        return simList({
          [R265]: [{ udid: 'OLD-W1', name: 'iPhone 17 (Quiesco 1)', state: 'Shutdown', deviceTypeIdentifier: T17 }],
          [R27]: [BASE, { udid: 'W1', name: 'iPhone 17 (Quiesco 1)', state: 'Shutdown', deviceTypeIdentifier: T17 }],
        });
      }
      return undefined;
    });
    const w1 = new IosProvider({ app: { bundleId: 'b' }, device: { device: 'iPhone 17', os: '27.0' }, exec: x.exec, logger: quiet, worker: { index: 1, count: 2 } });
    await w1.boot();
    expect(x.calls).toContain('xcrun simctl boot W1');
    expect(x.calls.some((c) => c.includes('OLD-W1') || c.includes('create'))).toBe(false);
  });

  it('udids[] gives each worker its own simulator and warns when they differ', async () => {
    const warnings: string[] = [];
    const x = fakeExec((line) =>
      line.includes('list devices available --json')
        ? simList({ [R27]: [BASE, { udid: 'AIR', name: 'iPhone Air', state: 'Booted', deviceTypeIdentifier: TAIR }] })
        : undefined,
    );
    const logger = { ...quiet, warn: (m: string) => void warnings.push(m) };
    const w0 = new IosProvider({ app: { bundleId: 'b' }, device: { udids: ['NEW-17', 'AIR'] }, exec: x.exec, logger, worker: { index: 0, count: 2 } });
    await w0.boot();
    expect(x.calls).toContain('xcrun simctl bootstatus NEW-17 -b');
    expect(warnings.join('\n')).toMatch(/mixes iPhone-17 \/ iOS-27-0, iPhone-Air \/ iOS-27-0/);

    const w2 = new IosProvider({ app: { bundleId: 'b' }, device: { udids: ['NEW-17', 'AIR'] }, exec: x.exec, logger, worker: { index: 2, count: 3 } });
    await expect(w2.boot()).rejects.toThrow(/lists 2 simulator\(s\), but this is worker 2 of 3/);
  });

  it('refuses one pinned udid for several workers', async () => {
    const x = fakeExec((line) => (line.includes('list devices') ? simList({ [R27]: [BASE] }) : undefined));
    const p = new IosProvider({ app: { bundleId: 'b' }, device: { udid: 'NEW-17' }, exec: x.exec, logger: quiet, worker: { index: 0, count: 2 } });
    await expect(p.boot()).rejects.toThrow(/devices.ios.udid pins one simulator/);
  });

  it('without binaryPath, a worker installs the app the (booted) base simulator has', async () => {
    const x = fakeExec((line) => {
      if (line.includes('list devices available --json')) return simList({ [R27]: [BASE, { udid: 'W1', name: 'iPhone 17 (Quiesco 1)', state: 'Booted', deviceTypeIdentifier: T17 }] });
      if (line.includes('get_app_container NEW-17 com.example.todo app')) return '/sims/NEW-17/Bundle/Todo.app\n';
      return undefined;
    });
    const w1 = new IosProvider({ app: { bundleId: 'com.example.todo' }, device: { device: 'iPhone 17' }, exec: x.exec, logger: quiet, worker: { index: 1, count: 2 } });
    await w1.boot();
    await w1.install();
    expect(x.calls).toContain('xcrun simctl install W1 /sims/NEW-17/Bundle/Todo.app');
  });

  it('finds the app in a shut-down base simulator by its bundle id', async () => {
    const data = tmp();
    const root = path.join(data, 'Containers/Bundle/Application');
    fs.mkdirSync(path.join(root, 'AAA/Other.app'), { recursive: true });
    fs.mkdirSync(path.join(root, 'BBB/Todo.app'), { recursive: true });
    const x = fakeExec((line) => {
      if (line.includes('list devices available --json')) {
        return simList({ [R27]: [{ ...BASE, state: 'Shutdown', dataPath: data }, { udid: 'W1', name: 'iPhone 17 (Quiesco 1)', state: 'Booted', deviceTypeIdentifier: T17 }] });
      }
      if (line.startsWith('plutil -extract CFBundleIdentifier')) return line.includes('Todo.app') ? 'com.example.todo\n' : 'com.example.other\n';
      return undefined;
    });
    const w1 = new IosProvider({ app: { bundleId: 'com.example.todo' }, device: { device: 'iPhone 17' }, exec: x.exec, logger: quiet, worker: { index: 1, count: 2 } });
    await w1.boot();
    await w1.install();
    expect(x.calls).toContain(`xcrun simctl install W1 ${path.join(root, 'BBB/Todo.app')}`);
  });

  it('says what to do when the base simulator does not have the app', async () => {
    const x = fakeExec((line) => {
      if (line.includes('list devices available --json')) return simList({ [R27]: [BASE, { udid: 'W1', name: 'iPhone 17 (Quiesco 1)', state: 'Booted', deviceTypeIdentifier: T17 }] });
      if (line.includes('get_app_container')) return new Error('not installed');
      return undefined;
    });
    const w1 = new IosProvider({ app: { bundleId: 'com.example.todo' }, device: { device: 'iPhone 17' }, exec: x.exec, logger: quiet, worker: { index: 1, count: 2 } });
    await w1.boot();
    await expect(w1.install()).rejects.toThrow(/not installed on the base simulator iPhone 17 \(iOS-27-0\), so worker 1 cannot copy it; set apps.ios.binaryPath/);
  });
});

// ---------------------------------------------------------------- Android

function avdHome(baseConfig = 'avd.ini.displayname=Medium Phone API 37.0\nhw.device.name=medium_phone\nimage.sysdir.1=system-images/android-37.0/x/\n'): string {
  const home = tmp();
  fs.mkdirSync(path.join(home, 'Medium.avd'));
  fs.writeFileSync(path.join(home, 'Medium.avd', 'config.ini'), baseConfig);
  fs.writeFileSync(path.join(home, 'Medium.ini'), `avd.ini.encoding=UTF-8\npath=${path.join(home, 'Medium.avd')}\npath.rel=avd/Medium.avd\ntarget=android-37.0\n`);
  return home;
}

/** adb with a base emulator on 5554; a worker emulator appears on 5556 once spawned. */
function fakeAdbWithWorker(extra: (line: string) => string | Error | undefined = () => undefined) {
  let spawned: string[] | null = null;
  const x = fakeExec((line) => {
    const own = extra(line);
    if (own !== undefined) return own;
    if (line === 'adb devices') return `List of devices attached\nemulator-5554\tdevice\n${spawned !== null ? 'emulator-5556\tdevice\n' : ''}`;
    if (line.includes('emulator-5554 shell getprop ro.boot.qemu.avd_name')) return 'Medium\n';
    if (line.includes('emulator-5556 shell getprop ro.boot.qemu.avd_name')) return 'Medium_quiesco_1\n';
    if (line.includes('getprop sys.boot_completed')) return '1\n';
    if (line.includes('dumpsys user')) return 'State: RUNNING_UNLOCKED\n';
    if (line.startsWith('ps ')) return '';
    return undefined;
  });
  return {
    ...x,
    spawn: (file: string, args: readonly string[]) => void (spawned = [file, ...args]),
    spawned: () => spawned,
  };
}

describe('Android worker AVDs', () => {
  it('copies only config.ini, with its own display name', () => {
    expect(workerAvdName('Medium', 2)).toBe('Medium_quiesco_2');
    expect(workerAvdConfig('avd.ini.displayname=Medium Phone\nhw.lcd.width=1080', 2)).toBe('avd.ini.displayname=Medium Phone (Quiesco 2)\nhw.lcd.width=1080');
    expect(workerAvdConfig('hw.lcd.width=1080', 1)).toBe('avd.ini.displayname=AVD (Quiesco 1)\nhw.lcd.width=1080');
  });

  it('worker N creates <avd>_quiesco_N and cold-boots it writable next to the base emulator', async () => {
    const home = avdHome();
    const adb = fakeAdbWithWorker();
    const p = new AndroidProvider({ app: { package: 'p' }, device: { avd: 'Medium' }, adbPath: 'adb', emulatorPath: 'emulator', exec: adb.exec, spawn: adb.spawn, pollMs: 1, logger: quiet, worker: { index: 1, count: 2 }, avdHome: home, hostPlatform: 'linux' });
    await p.boot();
    expect(adb.spawned()).toEqual(['emulator', '-avd', 'Medium_quiesco_1', '-no-boot-anim', '-no-snapshot-load', '-no-snapshot-save']);
    expect(adb.spawned()).not.toContain('-read-only');
    expect(fs.readFileSync(path.join(home, 'Medium_quiesco_1.avd', 'config.ini'), 'utf8')).toMatch(/^avd.ini.displayname=Medium Phone API 37.0 \(Quiesco 1\)\nhw.device.name=medium_phone/);
    const ini = fs.readFileSync(path.join(home, 'Medium_quiesco_1.ini'), 'utf8');
    expect(ini).toContain(`path=${path.join(home, 'Medium_quiesco_1.avd')}`);
    expect(ini).toContain('target=android-37.0');
    expect(adb.calls).toContain('adb -s emulator-5556 shell input keyevent KEYCODE_WAKEUP');
  });

  it('wipes the worker data when the base AVD changed, and leaves it alone otherwise', async () => {
    const home = avdHome();
    const boot = async () => {
      const adb = fakeAdbWithWorker();
      await new AndroidProvider({ app: { package: 'p' }, device: { avd: 'Medium' }, adbPath: 'adb', emulatorPath: 'emulator', exec: adb.exec, spawn: adb.spawn, pollMs: 1, logger: quiet, worker: { index: 1, count: 2 }, avdHome: home }).boot();
      return adb.spawned() ?? [];
    };
    expect(await boot()).not.toContain('-wipe-data');
    expect(await boot()).not.toContain('-wipe-data');
    fs.writeFileSync(path.join(home, 'Medium.avd', 'config.ini'), 'avd.ini.displayname=Medium Phone API 38\nimage.sysdir.1=system-images/android-38/x/\n');
    expect(await boot()).toContain('-wipe-data');
  });

  it('attaches to a running worker emulator without touching its AVD', async () => {
    const home = avdHome();
    const x = fakeExec((line) => {
      if (line === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n';
      if (line.includes('emulator-5554 shell getprop ro.boot.qemu.avd_name')) return 'Medium\n';
      if (line.includes('emulator-5556 shell getprop ro.boot.qemu.avd_name')) return 'Medium_quiesco_1\n';
      if (line.includes('getprop sys.boot_completed')) return '1\n';
      return undefined;
    });
    let spawned = false;
    const p = new AndroidProvider({ app: { package: 'p' }, device: { avd: 'Medium' }, adbPath: 'adb', exec: x.exec, spawn: () => void (spawned = true), pollMs: 1, logger: quiet, worker: { index: 1, count: 2 }, avdHome: home });
    await p.boot();
    expect(spawned).toBe(false);
    expect(fs.existsSync(path.join(home, 'Medium_quiesco_1.avd'))).toBe(false);
    expect(x.calls).toContain('adb -s emulator-5556 shell svc power stayon true');
  });

  it('needs devices.android.avd (or serials) for workers N > 0, and serials for a pinned serial', async () => {
    const adb = fakeAdbWithWorker();
    const mk = (device: object, index: number) =>
      new AndroidProvider({ app: { package: 'p' }, device, adbPath: 'adb', exec: adb.exec, spawn: adb.spawn, pollMs: 1, logger: quiet, worker: { index, count: 2 }, avdHome: tmp() });
    await expect(mk({}, 1).boot()).rejects.toThrow(/worker 1 needs an emulator of its own: set devices.android.avd/);
    await expect(mk({ serial: 'emulator-5554' }, 0).boot()).rejects.toThrow(/devices.android.serial pins one device/);
    await expect(mk({ avd: 'Nope' }, 1).boot()).rejects.toThrow(/AVD Nope not found/);
  });

  it('serials[] gives each worker its own device and warns when models differ', async () => {
    const warnings: string[] = [];
    const x = fakeExec((line) => {
      if (line === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\nR58M\tdevice\n';
      if (line.includes('getprop sys.boot_completed')) return '1\n';
      if (line.includes('emulator-5554 shell getprop ro.product.model')) return 'sdk_gphone64_arm64\n';
      if (line.includes('R58M shell getprop ro.product.model')) return 'SM-G991B\n';
      if (line.includes('getprop ro.build.version.sdk')) return '37\n';
      return undefined;
    });
    const p = new AndroidProvider({ app: { package: 'p' }, device: { serials: ['emulator-5554', 'R58M'] }, adbPath: 'adb', exec: x.exec, pollMs: 1, logger: { ...quiet, warn: (m: string) => void warnings.push(m) }, worker: { index: 0, count: 2 } });
    await p.boot();
    expect(x.calls).toContain('adb -s emulator-5554 shell input keyevent KEYCODE_WAKEUP');
    expect(warnings.join('\n')).toMatch(/mixes sdk_gphone64_arm64 \/ API 37, SM-G991B \/ API 37/);
  });

  it('without binaryPath, a worker installs the APKs from the base emulator', async () => {
    const home = avdHome();
    const adb = fakeAdbWithWorker((line) =>
      line.includes('emulator-5554 shell pm path') ? 'package:/data/app/x/base.apk\npackage:/data/app/x/split_config.arm64_v8a.apk\n' : undefined,
    );
    const p = new AndroidProvider({ app: { package: 'com.example.todo' }, device: { avd: 'Medium' }, adbPath: 'adb', emulatorPath: 'emulator', exec: adb.exec, spawn: adb.spawn, pollMs: 1, logger: quiet, worker: { index: 1, count: 2 }, avdHome: home });
    await p.boot();
    await p.install();
    const pulls = adb.calls.filter((c) => c.startsWith('adb -s emulator-5554 pull'));
    expect(pulls).toHaveLength(2);
    const install = adb.calls.find((c) => c.startsWith('adb -s emulator-5556 install-multiple -r -g'));
    expect(install).toMatch(/0-base\.apk .*1-split_config\.arm64_v8a\.apk$/);
  });

  it('says what to do when the base emulator is not running', async () => {
    const home = avdHome();
    let phase: 'boot' | 'install' = 'boot';
    const adb = fakeAdbWithWorker((line) => (phase === 'install' && line === 'adb devices' ? 'List of devices attached\nemulator-5556\tdevice\n' : undefined));
    const p = new AndroidProvider({ app: { package: 'com.example.todo' }, device: { avd: 'Medium' }, adbPath: 'adb', emulatorPath: 'emulator', exec: adb.exec, spawn: adb.spawn, pollMs: 1, logger: quiet, worker: { index: 1, count: 2 }, avdHome: home });
    await p.boot();
    phase = 'install';
    await expect(p.install()).rejects.toThrow(/worker 1 cannot copy com.example.todo from the base emulator Medium: it is not running; set apps.android.binaryPath/);
  });
});

// ---------------------------------------------------------------- child processes

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  readonly signals: string[] = [];
  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? 'SIGTERM');
    return true;
  }
  exit(): void {
    this.exitCode = 0;
    this.emit('exit', 0);
  }
}

describe('killChildProcessesSync', () => {
  it('kills the tracked children still running, once', () => {
    killChildProcessesSync();
    const running = trackChildProcess(new FakeChild());
    const done = trackChildProcess(new FakeChild());
    done.exit();
    expect(killChildProcessesSync()).toBe(1);
    expect(running.signals).toEqual(['SIGKILL']);
    expect(done.signals).toEqual([]);
    expect(killChildProcessesSync()).toBe(0);
  });
});

// ---------------------------------------------------------------- ANR dialogs (HU 2026-11-12)

describe('Android "isn\'t responding" dialogs', () => {
  const DUMP = '<hierarchy><node text="Close app" resource-id="android:id/aerr_close" package="android" clickable="true" enabled="true" bounds="[100,1000][900,1100]"/><node text="Wait" resource-id="android:id/aerr_wait" package="android" clickable="true" enabled="true" bounds="[100,1200][900,1300]"/></hierarchy>';

  function anrDevice(pkgs: string[]) {
    const left = [...pkgs];
    const x = fakeExec((line) => {
      if (line === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (line.includes('getprop sys.boot_completed')) return '1\n';
      if (line.includes('dumpsys window windows')) return left.length > 0 ? `Window{1 u0 Application Not Responding: ${left[0]}}\n` : 'Window{2 u0 dev.app/.Main}\n';
      if (line.includes('cat /sdcard/quiesco-ui.xml')) return DUMP;
      if (line.includes('input tap 500 1250')) left.shift();
      return undefined;
    });
    const warnings: string[] = [];
    const p = new AndroidProvider({ app: { package: 'dev.app' }, device: { serial: 'emulator-5554' }, adbPath: 'adb', exec: x.exec, pollMs: 1, logger: { ...quiet, warn: (m: string) => void warnings.push(m) } });
    return { p, calls: x.calls, warnings };
  }

  it('chooses Wait on another app\'s dialog and warns about the load', async () => {
    const { p, calls, warnings } = anrDevice(['com.android.systemui']);
    await p.boot();
    expect(await p.dismissSystemAlerts()).toEqual([`"com.android.systemui isn't responding"`]);
    expect(calls).toContain('adb -s emulator-5554 shell input tap 500 1250');
    expect(warnings[0]).toMatch(/com.android.systemui isn't responding.*chose Wait.*load average .* run fewer parallel workers/);
  });

  it('is a cheap window check when nothing is up', async () => {
    const { p, calls } = anrDevice([]);
    await p.boot();
    expect(await p.dismissSystemAlerts()).toEqual([]);
    expect(calls.some((c) => c.includes('uiautomator'))).toBe(false);
  });

  it('leaves the dialog up when the app under test itself hangs', async () => {
    const { p, calls, warnings } = anrDevice(['dev.app']);
    await p.boot();
    expect(await p.dismissSystemAlerts()).toEqual([]);
    expect(calls.some((c) => c.includes('input tap'))).toBe(false);
    expect(warnings[0]).toMatch(/dev.app itself isn't responding/);
  });

  it('runs before each scenario (resetDeviceState)', async () => {
    const { p } = anrDevice(['com.android.systemui']);
    await p.boot();
    await p.resetDeviceState();
    expect(await p.dismissSystemAlerts()).toEqual([]);
  });
});

describe('iOS sendNotification without permission (Phase 6.12)', () => {
  it('explains a simulator where the app may not show notifications', async () => {
    const x = fakeExec((line) => {
      if (line.includes('list devices available --json')) return simList({ [R27]: [{ udid: 'W1', name: 'iPhone 17 (Quiesco 1)', state: 'Booted', deviceTypeIdentifier: T17 }] });
      if (line.includes('simctl push')) return new Error('xcrun simctl push W1 … failed: Repository could not save notification. Source is not authorized.');
      return undefined;
    });
    const p = new IosProvider({ app: { bundleId: 'dev.app' }, device: { udid: 'W1' }, exec: x.exec, logger: quiet });
    await p.boot();
    await expect(p.sendNotification({ title: 'Hi' })).rejects.toMatchObject({
      errorName: 'DEVICE_ERROR',
      message: expect.stringMatching(/dev.app may not show notifications on iPhone 17 \(Quiesco 1\)/),
      data: { hint: expect.stringMatching(/allowPermission/) },
    });
  });
});

describe('connect timeout of the first launch (Phase 6.12)', () => {
  it('gives the session\'s first launch (right after installing) three times as long, unless configured', () => {
    expect(launchConnectTimeout({ apps: {} }, { first: true })).toBe(90_000);
    expect(launchConnectTimeout({ apps: {} }, { first: false })).toBe(30_000);
    expect(launchConnectTimeout({ apps: {}, connectTimeoutMs: 45_000 }, { first: true })).toBe(45_000);
  });
});
