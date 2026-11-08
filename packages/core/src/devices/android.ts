/**
 * Android via adb (requirements.md §6.9; docs/spikes/05, findings "Android 运行环境注意事项").
 * - boot: attach to the configured serial / a running emulator of the configured AVD, or boot the AVD;
 *   then wake the screen and keep it on (a sleeping emulator never brings the app to the front).
 * - Parallel workers (worker.count > 1) each get their own device: `serials[N]`; or, with `avd`, the
 *   emulator on console port 5554 + 2N (booted with `-port -read-only`: the emulator runs one AVD several
 *   times only when every instance is read-only); or else the N-th connected device.
 * - Emulators Quiesco boots always cold-boot (`-no-snapshot-load -no-snapshot-save`): a quick-boot
 *   snapshot goes stale once the app is installed into /data after it was taken, and Android then
 *   restarts its userspace about 30 s after "boot completed" (adb reverse and the app are gone). A
 *   cold boot took 14 s vs 40 s for snapshot + restart (API 37).
 * - install: `am force-stop` before `install -r` (see install()).
 * - launch: `adb reverse` for the Quiesco port (and Metro for dev clients), pre-grant
 *   ACCESS_LOCAL_NETWORK (Android 17; ignored where unknown), then `am start` with the connection
 *   parameters as intent extras. The whole device command is one quoted string: the device shell would
 *   otherwise split the dev-client URL at `&`.
 */
import path from 'node:path';

import { LAUNCH_PARAM_PORT, LAUNCH_PARAM_SESSION } from '@quiesco/protocol';
import type { HostInput } from '@quiesco/protocol';

import type { AndroidAppConfig, AndroidDeviceConfig } from '../config.js';
import { QuiescoError } from '../errors.js';
import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';
import type { Exec, Spawn } from './exec.js';
import { execCommand, shq, spawnDetached } from './exec.js';
import type { Permission } from './permissions.js';
import type { DeviceProvider, LaunchParams, WorkerInfo } from './provider.js';

const ANDROID_PERMISSIONS: Record<Permission, string[]> = {
  camera: ['android.permission.CAMERA'],
  microphone: ['android.permission.RECORD_AUDIO'],
  location: ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'],
  notifications: ['android.permission.POST_NOTIFICATIONS'],
  contacts: ['android.permission.READ_CONTACTS'],
  photos: ['android.permission.READ_MEDIA_IMAGES'],
  calendar: ['android.permission.READ_CALENDAR', 'android.permission.WRITE_CALENDAR'],
};

export interface AndroidProviderOptions {
  app: AndroidAppConfig;
  device?: AndroidDeviceConfig;
  logger?: Logger;
  exec?: Exec;
  spawn?: Spawn;
  /** Paths of the SDK tools. Default: `$ANDROID_HOME/platform-tools/adb`, `$ANDROID_HOME/emulator/emulator`, else PATH. */
  adbPath?: string;
  emulatorPath?: string;
  /** Polling interval while waiting for the emulator to boot. */
  pollMs?: number;
  /** The parallel worker this provider serves. Default: the only worker. */
  worker?: WorkerInfo;
}

/** First emulator console port; adb names the emulator on console port P `emulator-P`. */
export const EMULATOR_BASE_PORT = 5554;

/** Console port of the emulator that parallel worker `index` uses for an AVD (ports come in pairs). */
export function emulatorPortForWorker(index: number): number {
  return EMULATOR_BASE_PORT + 2 * index;
}

function sdkTool(rel: string, fallback: string): string {
  const home = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'];
  return home !== undefined ? path.join(home, rel) : fallback;
}

export class AndroidProvider implements DeviceProvider {
  readonly platform = 'android' as const;
  private serial: string | null = null;
  private bootedByUs = false;
  private readonly exec: Exec;
  private readonly spawn: Spawn;
  private readonly logger: Logger;
  private readonly adb: string;
  private readonly emulator: string;

  constructor(private readonly options: AndroidProviderOptions) {
    this.exec = options.exec ?? execCommand;
    this.spawn = options.spawn ?? spawnDetached;
    this.logger = options.logger ?? silentLogger;
    this.adb = options.adbPath ?? sdkTool('platform-tools/adb', 'adb');
    this.emulator = options.emulatorPath ?? sdkTool('emulator/emulator', 'emulator');
  }

  private get pkg(): string {
    return this.options.app.package;
  }

  private async adbRun(args: readonly string[], timeoutMs?: number): Promise<string> {
    if (this.serial === null) throw new QuiescoError('DEVICE_ERROR', 'Android device not booted (call boot() first)');
    const { stdout } = await this.exec(this.adb, ['-s', this.serial, ...args], timeoutMs === undefined ? {} : { timeoutMs });
    return stdout.toString();
  }

  private shell(command: string): Promise<string> {
    return this.adbRun(['shell', command]);
  }

  /** Online devices from `adb devices`. */
  private async devices(): Promise<string[]> {
    const { stdout } = await this.exec(this.adb, ['devices']);
    return stdout
      .toString()
      .split('\n')
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter((cols) => cols[1] === 'device')
      .map((cols) => cols[0] as string);
  }

  /**
   * AVD name of a running emulator. `ro.boot.qemu.avd_name` works without the emulator console;
   * `adb emu avd name` prints nothing when console authentication is enabled (seen on API 37).
   */
  private async avdName(serial: string): Promise<string | null> {
    if (!serial.startsWith('emulator-')) return null;
    for (const args of [['shell', 'getprop ro.boot.qemu.avd_name'], ['emu', 'avd', 'name']]) {
      try {
        const { stdout } = await this.exec(this.adb, ['-s', serial, ...args]);
        const name = stdout.toString().split('\n')[0]?.trim() ?? '';
        if (name !== '') return name;
      } catch {
        // try the next source
      }
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private get worker(): WorkerInfo {
    return this.options.worker ?? { index: 0, count: 1 };
  }

  async boot(): Promise<void> {
    const cfg = this.options.device ?? {};
    const worker = this.worker;
    const parallel = worker.count > 1;
    const bootTimeoutMs = cfg.bootTimeoutMs ?? 180_000;
    const online = await this.devices();
    const requireOnline = (serial: string): string => {
      if (!online.includes(serial)) throw new QuiescoError('DEVICE_ERROR', `Android device ${serial} is not connected (adb devices: ${online.join(', ') || 'none'})`);
      return serial;
    };
    if (cfg.serials !== undefined && cfg.serials.length > 0) {
      const serial = cfg.serials[worker.index];
      if (serial === undefined) {
        throw new QuiescoError('DEVICE_ERROR', `devices.android.serials lists ${cfg.serials.length} device(s), but this is worker ${worker.index} of ${worker.count}; add one serial per worker`);
      }
      this.serial = requireOnline(serial);
    } else if (cfg.serial !== undefined) {
      if (parallel) {
        throw new QuiescoError('CONFIG_ERROR', `devices.android.serial pins one device, but ${worker.count} workers run in parallel; set devices.android.serials (one per worker) or devices.android.avd`);
      }
      this.serial = requireOnline(cfg.serial);
    } else if (cfg.avd !== undefined) {
      if (parallel) {
        this.serial = await this.workerEmulator(cfg.avd, online, bootTimeoutMs);
      } else {
        for (const s of online) if ((await this.avdName(s)) === cfg.avd) this.serial = s;
        if (this.serial === null) this.serial = await this.bootAvd(cfg.avd, online, bootTimeoutMs);
      }
    } else if (parallel) {
      const sorted = [...online].sort();
      if (sorted.length < worker.count) {
        throw new QuiescoError(
          'DEVICE_ERROR',
          `${worker.count} workers need ${worker.count} Android devices, but ${sorted.length} are connected (${sorted.join(', ') || 'none'}); set devices.android.avd to boot one emulator per worker`,
        );
      }
      this.serial = sorted[worker.index] as string;
    } else {
      if (online.length === 0) throw new QuiescoError('DEVICE_ERROR', 'No Android device or emulator is running; set devices.android.avd to boot one');
      this.serial = online[0] as string;
      if (online.length > 1) this.logger.warn(`Several Android devices are connected; using ${this.serial} (set devices.android.serial to choose)`);
    }
    if (parallel) this.logger.info(`worker ${worker.index}: Android device ${this.serial}`);
    await this.waitForBoot(bootTimeoutMs);
    // A sleeping emulator does not bring the app to the foreground (findings, 0.1).
    await this.shell('input keyevent KEYCODE_WAKEUP');
    await this.shell('svc power stayon true');
    await this.shell('wm dismiss-keyguard').catch(() => undefined);
  }

  /** Command lines of the running emulator processes for `avd` (adb may not have attached them yet). */
  private async avdProcesses(avd: string): Promise<string[]> {
    try {
      const { stdout } = await this.exec('ps', ['-ax', '-o', 'command']);
      return stdout
        .toString()
        .split('\n')
        .filter((l) => /emulator|qemu-system/.test(l) && new RegExp(`(^|\\s)-avd\\s+${avd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(l));
    } catch {
      return [];
    }
  }

  private async avdProcessRunning(avd: string): Promise<boolean> {
    return (await this.avdProcesses(avd)).length > 0;
  }

  private async bootAvd(avd: string, before: string[], timeoutMs: number): Promise<string> {
    if (await this.avdProcessRunning(avd)) {
      throw new QuiescoError(
        'DEVICE_ERROR',
        `An emulator for AVD ${avd} is already running, but none of the adb devices (${before.join(', ') || 'none'}) reports that AVD name. ` +
          'Set devices.android.serial to use it, or restart adb (`adb kill-server`).',
      );
    }
    this.logger.info(`booting Android emulator ${avd}`);
    this.spawn(this.emulator, ['-avd', avd, '-no-boot-anim', '-no-snapshot-load', '-no-snapshot-save']);
    this.bootedByUs = true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const added = (await this.devices()).filter((s) => !before.includes(s));
      if (added.length > 0) return added[0] as string;
      await this.sleep(this.options.pollMs ?? 1000);
    }
    throw new QuiescoError('DEVICE_ERROR', `Emulator ${avd} did not appear in adb devices within ${timeoutMs}ms`);
  }

  /**
   * Parallel worker N's emulator of `avd`: the one on console port 5554 + 2N, booted there if not
   * running. Every instance is `-read-only` (changes are discarded on exit; the app is installed on
   * every run anyway): the emulator refuses a second instance of an AVD while a writable one runs
   * ("run all emulators with -read-only flag").
   */
  private async workerEmulator(avd: string, online: string[], timeoutMs: number): Promise<string> {
    const index = this.worker.index;
    const port = emulatorPortForWorker(index);
    const serial = `emulator-${port}`;
    if (online.includes(serial)) {
      const name = await this.avdName(serial);
      if (name !== avd) {
        throw new QuiescoError(
          'DEVICE_ERROR',
          `Worker ${index} uses the emulator on port ${port} (${serial}), but it runs AVD ${name ?? 'unknown'} instead of ${avd}. Stop it, or set devices.android.serials`,
        );
      }
      return serial;
    }
    const writable = (await this.avdProcesses(avd)).filter((l) => !/(^|\s)-read-only(\s|$)/.test(l));
    if (writable.length > 0) {
      const p = /(?:^|\s)-port\s+(\d+)/.exec(writable[0] as string)?.[1];
      // Without `-port` on its command line, name the connected emulators of this AVD instead.
      const candidates = p !== undefined ? [`emulator-${p}`] : [];
      if (candidates.length === 0) for (const s of online) if ((await this.avdName(s)) === avd) candidates.push(s);
      const kill = candidates.map((c) => `adb -s ${c} emu kill`).join(' or ');
      throw new QuiescoError(
        'DEVICE_ERROR',
        `A writable instance of AVD ${avd} is running${candidates.length === 1 ? ` (${candidates[0]})` : ''}, so worker ${index} cannot boot another one: ` +
          'the emulator runs several instances of one AVD only when all are -read-only. ' +
          `Stop it${kill !== '' ? ` (${kill})` : ''} and rerun; Quiesco boots every worker's instance read-only.`,
      );
    }
    const args = ['-avd', avd, '-port', String(port), '-no-boot-anim', '-no-snapshot-load', '-no-snapshot-save', '-read-only'];
    this.logger.info(`worker ${index}: booting Android emulator ${avd} on port ${port} (read-only)`);
    this.spawn(this.emulator, args);
    this.bootedByUs = true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await this.devices()).includes(serial)) return serial;
      await this.sleep(this.options.pollMs ?? 1000);
    }
    throw new QuiescoError(
      'DEVICE_ERROR',
      `Emulator ${avd} on port ${port} did not appear in adb devices within ${timeoutMs}ms. Check the emulator output: ${this.emulator} ${args.join(' ')}`,
    );
  }

  /**
   * Boot completed AND the user unlocked. Until the user is RUNNING_UNLOCKED, the package manager hides
   * components that are not direct-boot aware: `am start` then fails with "Activity class does not
   * exist" (seen after an emulator's system server restarted overnight with the user stuck in BOOTING).
   */
  private async waitForBoot(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const done = await this.shell('getprop sys.boot_completed').catch(() => '');
      if (done.trim() === '1') break;
      if (Date.now() >= deadline) throw new QuiescoError('DEVICE_ERROR', `Android device ${this.serial} did not finish booting within ${timeoutMs}ms`);
      await this.sleep(this.options.pollMs ?? 1000);
    }
    for (;;) {
      const users = await this.shell('dumpsys user').catch(() => '');
      const state = /State:\s*(\w+)/.exec(users)?.[1] ?? 'unknown';
      if (state === 'RUNNING_UNLOCKED' || users === '') return; // empty: dumpsys unavailable, do not block
      if (Date.now() >= deadline) {
        throw new QuiescoError(
          'DEVICE_ERROR',
          `Android user on ${this.serial} is not unlocked (state ${state}); apps cannot start. Reboot the device: adb -s ${this.serial} reboot`,
        );
      }
      await this.shell('input keyevent KEYCODE_WAKEUP').catch(() => undefined);
      await this.shell('wm dismiss-keyguard').catch(() => undefined);
      await this.sleep(this.options.pollMs ?? 1000);
    }
  }

  async install(): Promise<void> {
    const apk = this.options.app.binaryPath;
    if (apk !== undefined) {
      // Stop the app first: on Android 17 updating a package whose task is on screen puts a placeholder
      // in that task, and when the update finishes SystemUI relaunches the task's base intent with
      // CLEAR_TASK and no extras, racing (and replacing) our `am start` with the connection parameters.
      await this.shell(`am force-stop ${shq(this.pkg)}`).catch(() => undefined);
      await this.adbRun(['install', '-r', '-g', path.resolve(apk)], 300_000);
      return;
    }
    const out = await this.shell(`pm path ${shq(this.pkg)}`).catch(() => '');
    if (!out.includes('package:')) {
      throw new QuiescoError('DEVICE_ERROR', `${this.pkg} is not installed on ${this.serial}; set apps.android.binaryPath or install the dev client first`);
    }
  }

  private metroPort(): number | null {
    const dc = this.options.app.devClient;
    if (dc === undefined) return null;
    const url = new URL(dc.metroUrl ?? 'http://localhost:8081');
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? Number(url.port || 80) : null;
  }

  async launch(params: LaunchParams): Promise<void> {
    await this.adbRun(['reverse', `tcp:${params.port}`, `tcp:${params.port}`]);
    const metro = this.metroPort();
    if (metro !== null) await this.adbRun(['reverse', `tcp:${metro}`, `tcp:${metro}`]);
    for (const p of this.options.app.reversePorts ?? []) await this.adbRun(['reverse', `tcp:${p}`, `tcp:${p}`]);
    await this.shell(`pm grant ${shq(this.pkg)} android.permission.ACCESS_LOCAL_NETWORK`).catch(() => undefined);
    const extras = `--es ${LAUNCH_PARAM_PORT} ${params.port} --es ${LAUNCH_PARAM_SESSION} ${shq(params.sessionId)}`;
    const dc = this.options.app.devClient;
    let command: string;
    if (dc !== undefined) {
      const metroUrl = dc.metroUrl ?? 'http://localhost:8081';
      const url = `${dc.scheme}://expo-development-client/?url=${encodeURIComponent(metroUrl)}&__expo_disable_onboarding=1&__expo_disable_fab=1&__expo_disable_auto_launch=1`;
      command = `am start -W -a android.intent.action.VIEW -d ${shq(url)} ${extras} ${shq(this.pkg)}`;
    } else {
      const activity = this.options.app.activity ?? '.MainActivity';
      command = `am start -W -n ${shq(`${this.pkg}/${activity}`)} ${extras}`;
    }
    const out = await this.shell(command);
    if (/Error:/.test(out)) throw new QuiescoError('DEVICE_ERROR', `am start failed: ${out.trim()}`);
  }

  async terminate(): Promise<void> {
    await this.shell(`am force-stop ${shq(this.pkg)}`);
  }

  async grantPermissions(perms: readonly Permission[]): Promise<void> {
    for (const p of perms) {
      const names = ANDROID_PERMISSIONS[p];
      if (names === undefined) {
        this.logger.warn(`permission "${p}" is not supported on Android; skipped`);
        continue;
      }
      for (const n of names) {
        await this.shell(`pm grant ${shq(this.pkg)} ${n}`).catch((e: unknown) =>
          this.logger.warn(`cannot grant ${n} (is it declared in the app manifest?): ${(e as Error).message}`),
        );
      }
    }
  }

  async screenshot(): Promise<Buffer> {
    if (this.serial === null) throw new QuiescoError('DEVICE_ERROR', 'Android device not booted');
    const { stdout } = await this.exec(this.adb, ['-s', this.serial, 'exec-out', 'screencap', '-p']);
    return stdout;
  }

  async injectInput(input: HostInput): Promise<void> {
    switch (input.kind) {
      case 'back':
        await this.shell('input keyevent KEYCODE_BACK');
        return;
      case 'navigate':
        await this.shell(`am start -W -a android.intent.action.VIEW -d ${shq(input.url)} ${shq(this.pkg)}`);
        return;
      default:
        throw new QuiescoError(
          'ACTION_NOT_SUPPORTED',
          `Real ${input.kind} input on Android needs @quiesco/native in the app (an e2e build with its config plugin); or set actions: { mode: 'js' }`,
          { action: input.kind, platform: 'android', hint: 'add @quiesco/native to the app and rebuild it with EXPO_PUBLIC_QUIESCO=1' },
        );
    }
  }

  async shutdown(): Promise<void> {
    if (this.serial === null) return;
    await this.adbRun(['reverse', '--remove-all']).catch(() => undefined);
    if (this.bootedByUs && this.options.device?.shutdown === true) await this.adbRun(['emu', 'kill']).catch(() => undefined);
  }

  async diagnose(params: LaunchParams): Promise<string[]> {
    const lines: string[] = [];
    const reverse = await this.adbRun(['reverse', '--list']).catch((e: unknown) => `(adb reverse --list failed: ${(e as Error).message})`);
    lines.push(reverse.includes(`tcp:${params.port}`) ? `adb reverse for tcp:${params.port} is set.` : `adb reverse for tcp:${params.port} is MISSING (current: ${reverse.trim().split('\n').join('; ') || 'none'})`);
    const pid = await this.shell(`pidof ${shq(this.pkg)}`).catch(() => '');
    lines.push(pid.trim() !== '' ? `${this.pkg} is running (pid ${pid.trim()}).` : `${this.pkg} is NOT running — did it crash on start? Check \`adb logcat\`.`);
    return lines;
  }
}
