// Phase 6.6 spike, second round after the example app allows dark mode and declares ja:
// dark mode on both platforms, iOS locale by -AppleLanguages, iOS permission revoke (no paste alert).
// Usage (from examples/todo-app): node ../../spikes/device-state/recheck.mts ios|android
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { IOS_DEV_MENU_ARGS } from '@quiesco/core';
import { LAUNCH_PARAM_PORT, LAUNCH_PARAM_SESSION } from '@quiesco/protocol';

import { call, log, open, pause, probeUntil } from './common.mts';

const platform = process.argv[2] === 'android' ? 'android' : 'ios';
const bundle = 'dev.quiesco.todo';
const metroUrl = process.env['QUIESCO_METRO_URL'] ?? 'http://localhost:8083';
const adb = path.join(process.env['ANDROID_HOME'] ?? `${process.env['HOME']}/Library/Android/sdk`, 'platform-tools/adb');
const sh = (cmd: string): string => execFileSync(adb, ['shell', cmd]).toString().trim();
const simctl = (...a: string[]): string => execFileSync('xcrun', ['simctl', ...a], { input: '' }).toString().trim();
const pid = (): string => /(\d+)\s+\S+\s+UIKitApplication:dev\.quiesco\.todo/.exec(simctl('spawn', 'booted', 'launchctl', 'list'))?.[1] ?? 'not running';

const s = await open(platform);
try {
  await probeUntil(s, 'baseline', () => true);
  if (platform === 'android') {
    sh('cmd uimode night yes');
    log('uimode now:', sh('cmd uimode night'));
    await probeUntil(s, 'dark', (p) => p.scheme === 'dark');
    sh('cmd uimode night no');
    await probeUntil(s, 'light', (p) => p.scheme === 'light');
  } else {
    simctl('ui', 'booted', 'appearance', 'dark');
    await probeUntil(s, 'dark', (p) => p.scheme === 'dark');
    simctl('ui', 'booted', 'appearance', 'light');
    await probeUntil(s, 'light', (p) => p.scheme === 'light');

    const { port, sessionId } = s.launchParams;
    for (const [langs, loc] of [['(ja)', 'ja_JP'], ['(en)', 'en_US']] as const) {
      simctl('launch', '--terminate-running-process', 'booted', bundle, '--initialUrl', metroUrl, ...IOS_DEV_MENU_ARGS,
        `-${LAUNCH_PARAM_PORT}`, String(port), `-${LAUNCH_PARAM_SESSION}`, sessionId, '-AppleLanguages', langs, '-AppleLocale', loc);
      await pause(1500); // spike: let the old connection drop
      await probeUntil(s, `locale ${langs}`, (p) => p.locale.startsWith(loc.slice(0, 2)));
    }

    simctl('privacy', 'booted', 'grant', 'location', bundle);
    const p1 = pid();
    simctl('privacy', 'booted', 'revoke', 'location', bundle);
    for (let i = 0; i < 6 && pid() === p1; i++) await pause(500);
    log('revoke: pid', p1, '→', pid());
    log('probe after revoke:', JSON.stringify(await call(s, 'spikeProbe')).slice(0, 160));
  }
} finally {
  if (platform === 'android') sh('cmd uimode night no');
  else simctl('ui', 'booted', 'appearance', 'light');
  await s.dispose();
}
