// Phase 6.6 spike on iOS: rotation (native geometry request), appearance, Dynamic Type, locale by
// relaunch arguments, permission revoke, clipboard written by simctl. Run from examples/todo-app.
import { execFileSync } from 'node:child_process';

import { IOS_DEV_MENU_ARGS } from '@quiesco/core';
import { LAUNCH_PARAM_PORT, LAUNCH_PARAM_SESSION } from '@quiesco/protocol';

import { call, log, open, pause, probeUntil } from './common.mts';
import type { Probe } from './common.mts';

const bundle = 'dev.quiesco.todo';
const metroUrl = process.env['QUIESCO_METRO_URL'] ?? 'http://localhost:8083';
const simctl = (...a: string[]): string => execFileSync('xcrun', ['simctl', ...a], { input: '' }).toString().trim();
const pid = (): string => /(\d+)\s+\S+\s+UIKitApplication:dev\.quiesco\.todo/.exec(simctl('spawn', 'booted', 'launchctl', 'list'))?.[1] ?? 'not running';
const out = process.env['SPIKE_OUT'] ?? '/tmp';

const s = await open('ios');
const { port, sessionId } = s.launchParams;
const contentSize0 = simctl('ui', 'booted', 'content_size');
const appearance0 = simctl('ui', 'booted', 'appearance');
try {
  const base = (await probeUntil(s, 'baseline', () => true)) as Probe;
  log('content_size', contentSize0, 'appearance', appearance0);

  // ① rotation
  log('① spikeOrientation(landscape):', await call(s, 'spikeOrientation', true as never));
  await probeUntil(s, '① landscape', (p) => p.window !== base.window);
  simctl('io', 'booted', 'screenshot', '--type=png', `${out}/ios-landscape.png`);
  log('① spikeOrientation(portrait):', await call(s, 'spikeOrientation', false as never));
  await probeUntil(s, '① portrait', (p) => p.window === base.window);

  // ② appearance, Dynamic Type, locale
  simctl('ui', 'booted', 'appearance', 'dark');
  await probeUntil(s, '② dark', (p) => p.scheme === 'dark');
  simctl('ui', 'booted', 'appearance', 'light');
  await probeUntil(s, '② light', (p) => p.scheme === 'light');
  for (const size of ['extra-extra-large', 'accessibility-extra-large', contentSize0]) {
    simctl('ui', 'booted', 'content_size', size);
    await probeUntil(s, `② content_size ${size}`, (p) => p.fontScale !== base.fontScale || size === contentSize0);
  }
  const pid0 = pid();
  simctl('launch', '--terminate-running-process', 'booted', bundle, '--initialUrl', metroUrl, ...IOS_DEV_MENU_ARGS,
    `-${LAUNCH_PARAM_PORT}`, String(port), `-${LAUNCH_PARAM_SESSION}`, sessionId, '-AppleLanguages', '(ja)', '-AppleLocale', 'ja_JP');
  await pause(1500); // spike: let the old connection drop
  await probeUntil(s, '② locale ja (relaunch)', (p) => p.locale.startsWith('ja'));
  log('② pid', pid0, '→', pid());

  // ④ clipboard written from outside the app
  execFileSync('xcrun', ['simctl', 'pbcopy', 'booted'], { input: 'from simctl' });
  const read = Promise.race([call(s, 'spikeClipboard', null as never), pause(6000).then(() => 'no answer in 6 s (paste alert?)')]);
  await pause(1500);
  simctl('io', 'booted', 'screenshot', '--type=png', `${out}/ios-paste.png`);
  log('④ app reads clipboard written by simctl pbcopy:', await read);
  log('④ app writes, simctl pbpaste reads:', await call(s, 'spikeClipboard', 'from app' as never), '/', simctl('pbpaste', 'booted'));

  // ③ permission revoke
  simctl('privacy', 'booted', 'grant', 'location', bundle);
  const pid1 = pid();
  simctl('privacy', 'booted', 'revoke', 'location', bundle);
  await pause(1500);
  log('③ revoke: pid before', pid1, 'after', pid());
  log('③ probe after revoke:', JSON.stringify(await call(s, 'spikeProbe')).slice(0, 200));
} finally {
  simctl('ui', 'booted', 'appearance', appearance0 === 'dark' ? 'dark' : 'light');
  simctl('ui', 'booted', 'content_size', contentSize0);
  await s.dispose();
}
