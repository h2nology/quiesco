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
import type { ColorScheme, DeviceProvider, InAppControls, LaunchParams, LaunchUrlHandling, NotificationSpec, StateChange, StatusBarOptions } from './provider.js';

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
  /** When biometrics.fail() last presented an unknown finger (the HAL's short lockout follows). */
  private lastBiometricFailure = 0;
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

  /**
   * SystemUI demo mode (the status bar of Android screenshots): allowed in settings, entered once, with
   * notification icons hidden; each option is one `com.android.systemui.demo` broadcast.
   */
  async setStatusBar(o: StatusBarOptions): Promise<void> {
    if (!this.restore.has('statusBar')) {
      const allowed = await this.settingValue('global', 'sysui_demo_allowed', '0');
      this.restore.set('statusBar', [demoBroadcast('exit'), `settings put global sysui_demo_allowed ${allowed}`]);
      await this.shell('settings put global sysui_demo_allowed 1');
      await this.demo('enter');
      await this.demo('notifications', ['visible', 'false']);
    }
    if (o.time !== undefined) await this.demo('clock', ['hhmm', o.time.replace(':', '').padStart(4, '0')]);
    if (o.batteryLevel !== undefined || o.charging !== undefined) {
      await this.demo('battery', [...(o.batteryLevel !== undefined ? ['level', String(o.batteryLevel)] : []), ...(o.charging !== undefined ? ['plugged', String(o.charging)] : [])]);
    }
    // Android draws 0-4 Wi-Fi levels where iOS has 0-3 bars.
    if (o.wifiBars !== undefined) await this.demo('network', ['wifi', 'show', 'level', String(Math.round((o.wifiBars * 4) / 3))]);
    if (o.dataNetwork === 'hide') await this.demo('network', ['mobile', 'hide']);
    else if (o.cellularBars !== undefined || o.dataNetwork !== undefined) {
      await this.demo('network', [
        'mobile',
        'show',
        ...(o.cellularBars !== undefined ? ['level', String(o.cellularBars)] : []),
        ...(o.dataNetwork !== undefined ? ['datatype', o.dataNetwork === 'wifi' ? 'null' : o.dataNetwork] : []),
      ]);
    }
  }

  async resetStatusBar(): Promise<void> {
    for (const c of this.restore.get('statusBar') ?? []) await this.shell(c).catch(() => undefined);
    this.restore.delete('statusBar');
  }

  private async demo(command: string, extras: string[] = []): Promise<void> {
    const out = await this.shell(demoBroadcast(command, extras));
    if (!/Broadcast completed/.test(out)) throw new QuiescoError('DEVICE_ERROR', `status bar demo mode (${command}) failed: ${out.trim()}`);
  }

  /** Wi-Fi and mobile data off (`svc`); `adb reverse` keeps working (spike 6.6), so Quiesco stays connected. */
  async setNetwork(offline: boolean): Promise<void> {
    if (!this.restore.has('network')) {
      const wifi = await this.settingValue('global', 'wifi_on', '1');
      const data = await this.settingValue('global', 'mobile_data', '1');
      this.restore.set('network', [`svc wifi ${wifi === '0' ? 'disable' : 'enable'}`, `svc data ${data === '0' ? 'disable' : 'enable'}`]);
    }
    await this.shell(`svc wifi ${offline ? 'disable' : 'enable'}`);
    await this.shell(`svc data ${offline ? 'disable' : 'enable'}`);
  }

  /** adb has no clipboard command: @quiesco/native reads and writes it in the app's process. */
  async setClipboard(text: string, app: InAppControls): Promise<void> {
    if (!(await app.setClipboard(text)).supported) throw clipboardNeedsNative('clipboard.set');
  }

  async getClipboard(app: InAppControls): Promise<string> {
    const r = await app.getClipboard();
    if (!r.supported) throw clipboardNeedsNative('clipboard.get');
    return r.text ?? '';
  }

  // ---- Phase 6.7 system integration (emulators: the console fakes the sensors; findings 6.7) ----

  private requireEmulator(action: string): void {
    if (this.serial === null || !this.serial.startsWith('emulator-')) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', `${action} needs an Android emulator (${this.serial ?? 'no device'} is not one)`, { action, platform: 'android' });
    }
  }

  /** Enrolled fingerprints (`dumpsys fingerprint`). */
  private async fingerprints(): Promise<number> {
    const out = await this.shell('dumpsys fingerprint').catch(() => '');
    return [...out.matchAll(/"count":(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
  }

  /**
   * No shell command enrolls a fingerprint: Settings' enrollment is driven like a user would — a screen-lock
   * PIN (required, set by Quiesco and removed with the fingerprints), the consent screen's primary button,
   * then the emulator sensor (`adb emu finger touch 1`) until the fingerprint is stored. Buttons are found
   * by position, not by their (localized) text. Removing the PIN deletes every fingerprint.
   */
  async setBiometricEnrollment(enrolled: boolean): Promise<{ leftApp: boolean }> {
    this.requireEmulator('biometrics.enroll');
    if (!enrolled) {
      for (const c of this.restore.get('biometrics') ?? []) await this.shell(c).catch(() => undefined);
      this.restore.delete('biometrics');
      return { leftApp: false };
    }
    if ((await this.fingerprints()) > 0) return { leftApp: false };
    const pin = await this.shell(`locksettings set-pin ${BIOMETRIC_PIN}`).catch((e: unknown) => (e as Error).message);
    if (!/Pin set/i.test(pin)) {
      throw new QuiescoError('DEVICE_ERROR', `biometrics.enroll: cannot set the screen-lock PIN Android requires for fingerprints (does the emulator already have a screen lock?): ${pin.trim()}`);
    }
    this.restore.set('biometrics', [`locksettings clear --old ${BIOMETRIC_PIN}`]);
    await this.shell('am start -W -a android.settings.FINGERPRINT_ENROLL');
    const deadline = Date.now() + ENROLL_TIMEOUT_MS;
    try {
      while ((await this.fingerprints()) === 0) {
        if (Date.now() > deadline) throw new QuiescoError('DEVICE_ERROR', `biometrics.enroll: Settings did not store a fingerprint within ${ENROLL_TIMEOUT_MS / 1000}s`);
        const nodes = parseUiNodes(await this.uiDump());
        if (nodes.some((n) => n.resourceId.endsWith(':id/password_entry'))) {
          await this.shell(`input text ${BIOMETRIC_PIN}`);
          await this.shell('input keyevent KEYCODE_ENTER');
        } else {
          const primary = primaryButton(nodes);
          if (primary !== null) await this.shell(`input tap ${primary.x} ${primary.y}`);
          else await this.adbRun(['emu', 'finger', 'touch', '1']);
        }
        await new Promise((r) => setTimeout(r, ENROLL_STEP_MS));
      }
    } finally {
      await this.shell('am force-stop com.android.settings').catch(() => undefined);
    }
    return { leftApp: true };
  }

  private async uiDump(): Promise<string> {
    await this.shell('uiautomator dump /sdcard/quiesco-ui.xml');
    return this.shell('cat /sdcard/quiesco-ui.xml');
  }

  /**
   * Finger 1 is the one enroll() stored; finger 2 is unknown. A touch before the authentication has started
   * is lost, so this waits until `dumpsys fingerprint` shows it started (BiometricScheduler STATE_STARTED,
   * about 0.5 s after the prompt is requested; findings 6.7). After an unknown finger the emulator's HAL
   * locks the sensor for about half a second (longer after several failures in a row, as devices do); a
   * touch in that time ends the authentication with a lockout error, so the next touch waits it out.
   */
  async presentBiometric(match: boolean): Promise<void> {
    const action = match ? 'biometrics.match' : 'biometrics.fail';
    this.requireEmulator(action);
    const deadline = Date.now() + AUTH_WAIT_MS;
    while (!AUTH_STARTED.test(await this.shell('dumpsys fingerprint').catch(() => ''))) {
      if (Date.now() > deadline) {
        throw new QuiescoError('DEVICE_ERROR', `${action}: no fingerprint authentication is waiting for a finger (did the app start one, e.g. LocalAuthentication.authenticateAsync()?)`, { action });
      }
      await new Promise((r) => setTimeout(r, AUTH_POLL_MS));
    }
    const cooldown = this.lastBiometricFailure + FAILURE_LOCKOUT_MS - Date.now();
    if (cooldown > 0) await new Promise((r) => setTimeout(r, cooldown));
    await this.adbRun(['emu', 'finger', 'touch', match ? '1' : '2']);
    this.lastBiometricFailure = match ? 0 : Date.now();
  }

  /**
   * Accelerometer pushes through the emulator console: the usual detectors (react-native-shake, the dev
   * menu) want several strong sign changes within a few seconds (8 above 1.33 g within 3 s).
   */
  async shake(): Promise<void> {
    this.requireEmulator('shake');
    for (let i = 0; i < SHAKE_PUSHES; i++) {
      await this.adbRun(['emu', 'sensor', 'set', 'acceleration', i % 2 === 0 ? '20:9.8:0' : '-20:9.8:0']);
      await new Promise((r) => setTimeout(r, SHAKE_PUSH_MS));
    }
    await this.adbRun(['emu', 'sensor', 'set', 'acceleration', '0:9.81:0']);
  }

  /** Posted by @quiesco/native as the app: an emulator has no push service to deliver through (HU 2026-11-09). */
  async sendNotification(n: NotificationSpec, app: InAppControls): Promise<void> {
    const r = await app.postNotification(n);
    if (!r.supported) {
      throw new QuiescoError('ACTION_NOT_SUPPORTED', 'sendNotification on Android needs @quiesco/native ≥ Phase 6.7 in the app (it posts the notification as the app)', {
        action: 'sendNotification',
        platform: 'android',
        hint: 'rebuild the app with EXPO_PUBLIC_QUIESCO=1 and @quiesco/expo-plugin',
      });
    }
    if (r.enabled === false) {
      throw new QuiescoError('DEVICE_ERROR', 'sendNotification: the app may not show notifications; grant them (config permissions: [\'notifications\'], or app.device.setPermission(\'notifications\', \'grant\'))');
    }
  }

  /** Pulls the notification shade down and taps the notification whose text is `title` (uiautomator). */
  async openNotification(title: string): Promise<void> {
    await this.shell('cmd statusbar expand-notifications');
    const deadline = Date.now() + NOTIFICATION_WAIT_MS;
    for (;;) {
      const nodes = parseUiNodes(await this.uiDump());
      const node = nodes.find((n) => n.text === title);
      if (node !== undefined) {
        await this.shell(`input tap ${(node.bounds.x1 + node.bounds.x2) >> 1} ${(node.bounds.y1 + node.bounds.y2) >> 1}`);
        return;
      }
      if (Date.now() > deadline) {
        await this.shell('cmd statusbar collapse').catch(() => undefined);
        const texts = nodes.map((n) => n.text).filter((t) => t !== '').slice(0, 12);
        throw new QuiescoError('DEVICE_ERROR', `openNotification: no notification "${title}" in the shade (texts there: ${texts.map((t) => JSON.stringify(t)).join(', ') || 'none'})`);
      }
      await new Promise((r) => setTimeout(r, NOTIFICATION_POLL_MS));
    }
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

/** `am broadcast` to SystemUI's demo mode; `extras` are key / value pairs. */
function demoBroadcast(command: string, extras: string[] = []): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < extras.length; i += 2) pairs.push(`-e ${extras[i] as string} ${shq(extras[i + 1] as string)}`);
  return ['am broadcast -a com.android.systemui.demo -e command', command, ...pairs].join(' ');
}

function clipboardNeedsNative(action: string): QuiescoError {
  return new QuiescoError('ACTION_NOT_SUPPORTED', `${action} on Android needs @quiesco/native ≥ Phase 6.6 in the app (adb has no clipboard command)`, {
    action,
    platform: 'android',
    hint: 'rebuild the app with EXPO_PUBLIC_QUIESCO=1 and @quiesco/expo-plugin',
  });
}

/** Screen-lock PIN Quiesco sets for fingerprint enrollment (Android requires one) and removes again. */
const BIOMETRIC_PIN = '7357';
const ENROLL_TIMEOUT_MS = 60_000;
const ENROLL_STEP_MS = 400;
/** An authentication BiometricScheduler has started (state 2), i.e. listening to the sensor. */
const AUTH_STARTED = /FingerprintAuthenticationClient[^\n]*State: 2\b/;
const AUTH_WAIT_MS = 5_000;
/** The HAL's timed lockout after one failed attempt (about 500 ms measured), with a margin. */
const FAILURE_LOCKOUT_MS = 1_000;
const AUTH_POLL_MS = 100;
const NOTIFICATION_WAIT_MS = 5_000;
const NOTIFICATION_POLL_MS = 300;
const SHAKE_PUSHES = 12;
const SHAKE_PUSH_MS = 80;

export interface UiNode {
  text: string;
  resourceId: string;
  clickable: boolean;
  enabled: boolean;
  bounds: { x1: number; y1: number; x2: number; y2: number };
}

/** Nodes of a `uiautomator dump`. */
export function parseUiNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const attrs = Object.fromEntries([...(m[1] as string).matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs['bounds'] ?? '');
    if (b === null) continue;
    nodes.push({
      text: attrs['text'] ?? '',
      resourceId: attrs['resource-id'] ?? '',
      clickable: attrs['clickable'] === 'true',
      enabled: attrs['enabled'] !== 'false',
      bounds: { x1: Number(b[1]), y1: Number(b[2]), x2: Number(b[3]), y2: Number(b[4]) },
    });
  }
  return nodes;
}

/**
 * Settings' primary footer button (Next / More / I agree / Done): an enabled clickable node in the bottom
 * fifth of the screen whose center is in the right half. Secondary buttons (No thanks / Do it later) sit
 * on the left, and the screens that wait for the sensor only have those.
 */
export function primaryButton(nodes: readonly UiNode[]): { x: number; y: number } | null {
  const width = Math.max(0, ...nodes.map((n) => n.bounds.x2));
  const height = Math.max(0, ...nodes.map((n) => n.bounds.y2));
  for (const n of nodes) {
    if (!n.clickable || !n.enabled) continue;
    const x = (n.bounds.x1 + n.bounds.x2) >> 1;
    const y = (n.bounds.y1 + n.bounds.y2) >> 1;
    const area = (n.bounds.x2 - n.bounds.x1) * (n.bounds.y2 - n.bounds.y1);
    if (y > height * 0.8 && x > width / 2 && area < (width * height) / 4) return { x, y };
  }
  return null;
}
