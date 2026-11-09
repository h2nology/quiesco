/**
 * Android via adb (requirements.md §6.9; docs/spikes/05, findings "Android 运行环境注意事项").
 * - boot: attach to the configured serial / a running emulator of the configured AVD, or boot the AVD;
 *   then wake the screen and keep it on (a sleeping emulator never brings the app to the front).
 * - Emulators Quiesco boots always cold-boot (`-no-snapshot-load -no-snapshot-save`): a quick-boot
 *   snapshot goes stale once the app is installed into /data after it was taken, and Android then
 *   restarts its userspace about 30 s after "boot completed" (adb reverse and the app are gone). A
 *   cold boot took 14 s vs 40 s for snapshot + restart (API 37).
 * - install: `am force-stop` before `install -r` (see install()).
 * - launch: `adb reverse` for the Quiesco port (and Metro for dev clients), pre-grant
 *   ACCESS_LOCAL_NETWORK (Android 17; ignored where unknown), then `am start` with the connection
 *   parameters as intent extras. The whole device command is one quoted string: the device shell would
 *   otherwise split the dev-client URL at `&`.
 * - Phase 6.5: launch arguments as `--es quiescoArgs <base64 JSON>`. A launch URL is the intent data;
 *   for dev clients it carries `__expo_url=<metro>` (expo-dev-launcher strips the `__expo_*` params and
 *   gives the app the rest, findings 6.5 spike). Background = HOME key, foreground = the launcher intent
 *   (the running task is resumed, no restart).
 */

/** expo-dev-launcher switches: open the app directly, without onboarding, the tools button or the dev menu. */
const DEV_LAUNCHER_FLAGS = '__expo_disable_onboarding=1&__expo_disable_fab=1&__expo_disable_auto_launch=1';

/** `url` (the app's deep link) as a dev-client launch URL that loads the bundle from `metroUrl` first. */
export function devClientLaunchUrl(url: string, metroUrl: string): string {
  const hash = url.indexOf('#');
  const base = hash >= 0 ? url.slice(0, hash) : url;
  const frag = hash >= 0 ? url.slice(hash) : '';
  const sep = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${sep}__expo_url=${encodeURIComponent(metroUrl)}&${DEV_LAUNCHER_FLAGS}${frag}`;
}
import path from 'node:path';

import { LAUNCH_PARAM_ARGS, LAUNCH_PARAM_PORT, LAUNCH_PARAM_SESSION } from '@quiesco/protocol';
import type { HostInput, Orientation } from '@quiesco/protocol';

import type { AndroidAppConfig, AndroidDeviceConfig } from '../config.js';
import { QuiescoError } from '../errors.js';
import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';
import type { Exec, Spawn } from './exec.js';
import { execCommand, shq, spawnDetached } from './exec.js';
import type { Permission } from './permissions.js';
import type { ColorScheme, DeviceProvider, LaunchParams, LaunchUrlHandling, StateChange } from './provider.js';

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
}

function sdkTool(rel: string, fallback: string): string {
  const home = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'];
  return home !== undefined ? path.join(home, rel) : fallback;
}

export class AndroidProvider implements DeviceProvider {
  readonly platform = 'android' as const;
  /**
   * react-native-gesture-handler on Android: ScaleGestureDetector starts after the span changes by
   * 2 × touchSlop and the pinch activates (resetting its scale) after one more touchSlop (8 dp); the
   * rotation activates at 5° and resets. Measured (Phase 6.4): about 26 dp and 9°.
   */
  readonly gestureSlop = { pinch: 26, rotation: (9 * Math.PI) / 180 };
  private serial: string | null = null;
  private bootedByUs = false;
  /** Shell commands that undo device-state changes (resetDeviceState), by setting. */
  private readonly restore = new Map<string, string[]>();
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

  async boot(): Promise<void> {
    const cfg = this.options.device ?? {};
    const online = await this.devices();
    if (cfg.serial !== undefined) {
      if (!online.includes(cfg.serial)) {
        throw new QuiescoError('DEVICE_ERROR', `Android device ${cfg.serial} is not connected (adb devices: ${online.join(', ') || 'none'})`);
      }
      this.serial = cfg.serial;
    } else if (cfg.avd !== undefined) {
      for (const s of online) if ((await this.avdName(s)) === cfg.avd) this.serial = s;
      if (this.serial === null) this.serial = await this.bootAvd(cfg.avd, online, cfg.bootTimeoutMs ?? 180_000);
    } else {
      if (online.length === 0) throw new QuiescoError('DEVICE_ERROR', 'No Android device or emulator is running; set devices.android.avd to boot one');
      this.serial = online[0] as string;
      if (online.length > 1) this.logger.warn(`Several Android devices are connected; using ${this.serial} (set devices.android.serial to choose)`);
    }
    await this.waitForBoot(cfg.bootTimeoutMs ?? 180_000);
    // A sleeping emulator does not bring the app to the foreground (findings, 0.1).
    await this.shell('input keyevent KEYCODE_WAKEUP');
    await this.shell('svc power stayon true');
    await this.shell('wm dismiss-keyguard').catch(() => undefined);
  }

  /** Whether an emulator process for `avd` is already running (adb may not have attached it yet). */
  private async avdProcessRunning(avd: string): Promise<boolean> {
    try {
      const { stdout } = await this.exec('ps', ['-ax', '-o', 'command']);
      return stdout
        .toString()
        .split('\n')
        .some((l) => /emulator|qemu-system/.test(l) && new RegExp(`(^|\\s)-avd\\s+${avd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(l));
    } catch {
      return false;
    }
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

  async launch(params: LaunchParams): Promise<LaunchUrlHandling | void> {
    await this.adbRun(['reverse', `tcp:${params.port}`, `tcp:${params.port}`]);
    const metro = this.metroPort();
    if (metro !== null) await this.adbRun(['reverse', `tcp:${metro}`, `tcp:${metro}`]);
    for (const p of this.options.app.reversePorts ?? []) await this.adbRun(['reverse', `tcp:${p}`, `tcp:${p}`]);
    await this.shell(`pm grant ${shq(this.pkg)} android.permission.ACCESS_LOCAL_NETWORK`).catch(() => undefined);
    let extras = `--es ${LAUNCH_PARAM_PORT} ${params.port} --es ${LAUNCH_PARAM_SESSION} ${shq(params.sessionId)}`;
    if (params.args !== undefined) extras += ` --es ${LAUNCH_PARAM_ARGS} ${shq(params.args)}`;
    const dc = this.options.app.devClient;
    let command: string;
    if (dc !== undefined) {
      const metroUrl = dc.metroUrl ?? 'http://localhost:8081';
      const url = params.url !== undefined
        ? devClientLaunchUrl(params.url, metroUrl)
        : `${dc.scheme}://expo-development-client/?url=${encodeURIComponent(metroUrl)}&${DEV_LAUNCHER_FLAGS}`;
      command = `am start -W -a android.intent.action.VIEW -d ${shq(url)} ${extras} ${shq(this.pkg)}`;
    } else if (params.url !== undefined) {
      command = `am start -W -a android.intent.action.VIEW -d ${shq(params.url)} ${extras} ${shq(this.pkg)}`;
    } else {
      command = `am start -W -n ${shq(`${this.pkg}/${this.activity}`)} ${extras}`;
    }
    const out = await this.shell(command);
    if (/Error:/.test(out)) throw new QuiescoError('DEVICE_ERROR', `am start failed: ${out.trim()}`);
    if (params.url !== undefined) return 'delivered';
  }

  private get activity(): string {
    return this.options.app.activity ?? '.MainActivity';
  }

  /** `pm clear`: data, caches and granted runtime permissions; the app is stopped. */
  async clearData(): Promise<void> {
    const out = await this.shell(`pm clear ${shq(this.pkg)}`);
    if (!/Success/.test(out)) throw new QuiescoError('DEVICE_ERROR', `pm clear ${this.pkg} failed: ${out.trim()}`);
  }

  async uninstall(): Promise<void> {
    const out = await this.adbRun(['uninstall', this.pkg]).catch((e: unknown) => (e as Error).message);
    if (!/Success/.test(out)) throw new QuiescoError('DEVICE_ERROR', `adb uninstall ${this.pkg} failed: ${out.trim()}`);
  }

  async sendToBackground(): Promise<void> {
    await this.shell('input keyevent KEYCODE_HOME');
  }

  /** The launcher intent resumes the existing task (dev clients too: the dev launcher ignores MAIN while an app is open). */
  async bringToForeground(): Promise<void> {
    const out = await this.shell(`am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${shq(`${this.pkg}/${this.activity}`)}`);
    if (/Error:/.test(out)) throw new QuiescoError('DEVICE_ERROR', `am start failed: ${out.trim()}`);
  }

  // ---- Phase 6.6 device state ----

  /** Fixed rotation: auto-rotate off, `user_rotation` 0 (portrait) / 1 (landscape). */
  async setOrientation(orientation: Orientation): Promise<void> {
    if (!this.restore.has('rotation')) {
      const auto = await this.settingValue('system', 'accelerometer_rotation', '1');
      const user = await this.settingValue('system', 'user_rotation', '0');
      this.restore.set('rotation', [`settings put system accelerometer_rotation ${auto}`, `settings put system user_rotation ${user}`]);
    }
    await this.shell('settings put system accelerometer_rotation 0');
    await this.shell(`settings put system user_rotation ${orientation === 'landscape' ? 1 : 0}`);
  }

  /** Emulator console `geo fix` (longitude first); real devices cannot fake a location from adb. */
  async setLocation(location: { latitude: number; longitude: number }): Promise<void> {
    if (this.serial === null || !this.serial.startsWith('emulator-')) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', `setLocation needs an Android emulator (${this.serial ?? 'no device'} is not one)`, { action: 'setLocation', platform: 'android' });
    }
    const out = await this.adbRun(['emu', 'geo', 'fix', String(location.longitude), String(location.latitude)]);
    if (/KO/.test(out)) throw new QuiescoError('DEVICE_ERROR', `adb emu geo fix failed: ${out.trim()}`);
  }

  /** `pm grant` / `pm revoke`. Android kills the app when a permission is revoked (spike 6.6). */
  async setPermission(permission: Permission, grant: boolean): Promise<StateChange> {
    const names = ANDROID_PERMISSIONS[permission];
    for (const n of names) {
      const out = await this.shell(`pm ${grant ? 'grant' : 'revoke'} ${shq(this.pkg)} ${n}`).catch((e: unknown) => (e as Error).message);
      if (/Exception|not a changeable|has not requested/i.test(out)) {
        throw new QuiescoError('DEVICE_ERROR', `pm ${grant ? 'grant' : 'revoke'} ${n} failed (is it declared in the app manifest?): ${out.trim()}`);
      }
    }
    return { relaunch: !grant };
  }

  async setAppearance(scheme: ColorScheme): Promise<void> {
    if (!this.restore.has('night')) {
      const now = /Night mode:\s*(\w+)/.exec(await this.shell('cmd uimode night').catch(() => ''))?.[1] ?? 'no';
      this.restore.set('night', [`cmd uimode night ${now}`]);
    }
    await this.shell(`cmd uimode night ${scheme === 'dark' ? 'yes' : 'no'}`);
  }

  /**
   * Font scale and app language are configuration changes the activity does not handle (React Native's
   * default `configChanges`): Android recreates it, React's root remounts in the same JS context, and
   * expo-router's imperative router stops working (Phase 6.6). The app is started again instead, so
   * it runs with the new setting from a clean state — as on iOS / the web for a locale.
   */
  async setFontScale(scale: number): Promise<StateChange & { scale: number }> {
    if (!this.restore.has('fontScale')) this.restore.set('fontScale', [`settings put system font_scale ${await this.settingValue('system', 'font_scale', '1.0')}`]);
    await this.shell(`settings put system font_scale ${scale}`);
    return { scale, relaunch: true };
  }

  /** Per-app language (Android 13+); the app is started again (see setFontScale). */
  async setLocale(locale: string | null): Promise<StateChange> {
    const out = await this.shell(`cmd locale set-app-locales ${shq(this.pkg)} --locales ${shq(locale ?? '')}`);
    if (/Unknown|Error|Exception/i.test(out)) throw new QuiescoError('DEVICE_ERROR', `cmd locale set-app-locales failed (Android 13+ needed): ${out.trim()}`);
    if (locale !== null) this.restore.set('locale', [`cmd locale set-app-locales ${shq(this.pkg)} --locales ''`]);
    else this.restore.delete('locale');
    return { relaunch: true };
  }

  async resetDeviceState(): Promise<StateChange> {
    // Restoring the font scale or the language recreates the activity again (see setFontScale).
    const relaunch = this.restore.has('fontScale') || this.restore.has('locale');
    for (const cmds of this.restore.values()) for (const c of cmds) await this.shell(c).catch(() => undefined);
    this.restore.clear();
    return { relaunch };
  }

  /** `settings get <ns> <key>`; `fallback` when unset ("null"). */
  private async settingValue(ns: string, key: string, fallback: string): Promise<string> {
    const v = (await this.shell(`settings get ${ns} ${key}`).catch(() => '')).trim();
    return v === '' || v === 'null' ? fallback : v;
  }

  async reversePort(port: number): Promise<void> {
    await this.adbRun(['reverse', `tcp:${port}`, `tcp:${port}`]);
  }

  async unreversePort(port: number): Promise<void> {
    await this.adbRun(['reverse', '--remove', `tcp:${port}`]).catch(() => undefined);
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
