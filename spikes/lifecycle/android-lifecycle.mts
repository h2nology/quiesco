// Phase 6.5 spike ① ② ④ on Android (dev client, emulator already running, Metro on QUIESCO_METRO_URL).
// Run from examples/todo-app: node ../../spikes/lifecycle/android-lifecycle.mts
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { Session } from '@quiesco/core';

const adb = path.join(process.env['ANDROID_HOME'] ?? `${process.env['HOME']}/Library/Android/sdk`, 'platform-tools/adb');
const metroUrl = process.env['QUIESCO_METRO_URL'] ?? 'http://localhost:8083';
const pkg = 'dev.quiesco.todo';
const sh = (cmd: string): string => execFileSync(adb, ['shell', cmd]).toString().trim();
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);

const session = await Session.create({
  platform: 'android',
  config: {
    apps: { android: { package: pkg, devClient: { scheme: 'quiescotodo', metroUrl }, reversePorts: [3001] } },
    devices: { android: {} },
    logLevel: 'warn',
  } as never,
});
const app = session.driver;
const { port, sessionId } = session.launchParams;
const extras = `--es quiescoPort ${port} --es quiescoSession ${shq(sessionId)}`;
const onPlayground = async (): Promise<boolean> => (await app.query({ id: 'playground' })).length > 0;
const info = (): Promise<unknown> => app.backdoor('lifecycleInfo');

try {
  log('launched; pid', sh(`pidof ${pkg}`), 'playground?', await onPlayground(), await info());

  // ② Cold start with a deep link through the dev client's `__expo_url` form.
  sh(`am force-stop ${pkg}`);
  const q = `__expo_url=${encodeURIComponent(metroUrl)}&__expo_disable_onboarding=1&__expo_disable_fab=1&__expo_disable_auto_launch=1`;
  const url = `quiescotodo://playground?${q}`;
  const t0 = Date.now();
  log('am start', sh(`am start -W -a android.intent.action.VIEW -d ${shq(url)} ${extras} ${pkg}`).split('\n').at(-1));
  log('② deep-link cold start: connected after', Date.now() - t0, 'ms; playground?', await onPlayground(), await info());

  // ① Background / foreground.
  const pid = sh(`pidof ${pkg}`);
  sh('input keyevent KEYCODE_HOME');
  const resumed = (): string => sh('dumpsys activity activities | grep -m1 -E "topResumedActivity|ResumedActivity"');
  log('① after HOME:', resumed());
  const bg = await Promise.race([info().then((v) => ['answered', v]), new Promise((r) => setTimeout(() => r(['no answer in 3 s']), 3000))]);
  log('① backdoor while in background:', bg);
  log('① foreground via launcher intent:', sh(`am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${pkg}/.MainActivity`).split('\n').at(-1));
  log('① after foreground:', resumed(), 'same pid?', sh(`pidof ${pkg}`) === pid, 'playground?', await onPlayground(), await info());

  // ④ pm clear, then the usual dev-client launch.
  log('④ pm clear:', sh(`pm clear ${pkg}`));
  log('④ permission after clear:', sh(`dumpsys package ${pkg} | grep -m1 ACCESS_FINE_LOCATION`));
  const t1 = Date.now();
  await (session as unknown as { launch(): Promise<void> }).launch();
  log('④ relaunched after pm clear: connected after', Date.now() - t1, 'ms; playground?', await onPlayground(), await info());
} catch (e) {
  log('FAILED', e);
} finally {
  await session.dispose();
}
