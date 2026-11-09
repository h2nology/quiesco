// Phase 6.5 spike ① detail: what answers while the Android app is in the background?
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Session } from '@quiesco/core';

const adb = path.join(process.env['ANDROID_HOME'] ?? `${process.env['HOME']}/Library/Android/sdk`, 'platform-tools/adb');
const sh = (cmd: string): string => execFileSync(adb, ['shell', cmd]).toString().trim();
const pkg = 'dev.quiesco.todo';
const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);
const within = <T,>(p: Promise<T>, ms: number): Promise<unknown> =>
  Promise.race([p.then((v) => ['ok', v], (e: Error) => ['error', e.message]), new Promise((r) => setTimeout(() => r([`no answer in ${ms} ms`]), ms))]);

const session = await Session.create({
  platform: 'android',
  config: { apps: { android: { package: pkg, devClient: { scheme: 'quiescotodo', metroUrl: process.env['QUIESCO_METRO_URL'] ?? 'http://localhost:8083' } } }, devices: { android: {} }, logLevel: 'warn' } as never,
});
const app = session.driver;
try {
  sh('input keyevent KEYCODE_HOME');
  log('getIdleState (no wait):', JSON.stringify(await within(app.getIdleState(), 3000)));
  const pending = app.backdoor('lifecycleInfo');
  log('backdoor (waits for idle):', JSON.stringify(await within(pending, 3000)));
  log('getIdleState again:', JSON.stringify(await within(app.getIdleState(), 3000)));
  sh(`am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${pkg}/.MainActivity`);
  log('pending backdoor after foreground:', JSON.stringify(await within(pending, 5000)));
} finally {
  await session.dispose();
}
