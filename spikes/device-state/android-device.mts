// Phase 6.6 spike on Android: rotation, appearance, font scale, per-app locale, permission revoke,
// clipboard, offline. Run from examples/todo-app: node ../../spikes/device-state/android-device.mts
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { call, log, open, probeUntil } from './common.mts';
import type { Probe } from './common.mts';

const adb = path.join(process.env['ANDROID_HOME'] ?? `${process.env['HOME']}/Library/Android/sdk`, 'platform-tools/adb');
const sh = (cmd: string): string => execFileSync(adb, ['shell', cmd]).toString().trim();
const pkg = 'dev.quiesco.todo';
const s = await open('android');
try {
  const base = (await probeUntil(s, 'baseline', () => true)) as Probe;
  const pid0 = sh(`pidof ${pkg}`);

  // ① rotation
  sh('settings put system accelerometer_rotation 0');
  sh('settings put system user_rotation 1');
  await probeUntil(s, '① landscape', (p) => p.window !== base.window);
  sh('settings put system user_rotation 0');
  await probeUntil(s, '① portrait', (p) => p.window === base.window);

  // ② appearance, font scale, locale
  sh('cmd uimode night yes');
  await probeUntil(s, '② dark', (p) => p.scheme === 'dark');
  sh('cmd uimode night no');
  await probeUntil(s, '② light', (p) => p.scheme === 'light');
  sh('settings put system font_scale 1.3');
  await probeUntil(s, '② font 1.3', (p) => Math.abs(p.fontScale - 1.3) < 0.01);
  sh('settings put system font_scale 1.0');
  await probeUntil(s, '② font 1.0', (p) => Math.abs(p.fontScale - 1) < 0.01);
  sh(`cmd locale set-app-locales ${pkg} --locales ja-JP`);
  await probeUntil(s, '② locale ja', (p) => p.locale.startsWith('ja'));
  log('② pid after locale', sh(`pidof ${pkg}`), 'was', pid0);
  sh(`cmd locale set-app-locales ${pkg} --locales ""`);
  await probeUntil(s, '② locale reset', (p) => !p.locale.startsWith('ja'));

  // ⑤ offline (before ③, which kills the app)
  log('⑤ fetch online:', await call(s, 'spikeFetch', 'https://example.com/' as never), '| mock via reverse:', await call(s, 'spikeFetch', 'http://localhost:3001/todos' as never));
  sh('svc wifi disable');
  sh('svc data disable');
  await probeUntil(s, '⑤ offline', (p) => !p.netinfo);
  log('⑤ fetch offline:', await call(s, 'spikeFetch', 'https://example.com/' as never), '| mock via reverse:', await call(s, 'spikeFetch', 'http://localhost:3001/todos' as never));
  sh('svc wifi enable');
  sh('svc data enable');
  await probeUntil(s, '⑤ online again', (p) => p.netinfo);

  // ④ clipboard (in-app; Android has no clipboard shell command)
  log('④ clipboard write/read in app:', await call(s, 'spikeClipboard', 'クリップ 1' as never));

  // ③ permission revoke
  sh(`pm grant ${pkg} android.permission.ACCESS_FINE_LOCATION`);
  const pid1 = sh(`pidof ${pkg}`);
  sh(`pm revoke ${pkg} android.permission.ACCESS_FINE_LOCATION`);
  const pid2 = (() => { try { return sh(`pidof ${pkg}`); } catch { return 'not running'; } })();
  log('③ revoke: pid before', pid1, 'after', pid2 || 'not running');
  log('③ probe after revoke:', JSON.stringify(await call(s, 'spikeProbe')).slice(0, 200));
} finally {
  sh('settings put system user_rotation 0');
  sh('cmd uimode night no');
  sh('settings put system font_scale 1.0');
  sh('svc wifi enable');
  sh('svc data enable');
  await s.dispose();
}
