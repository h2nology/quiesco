// 6.7 batch C spike ③: iOS system UI through an XCUITest runner serving SpringBoard over HTTP
// (spikes/ios-xcuitest). Measures the runner's start and request latency, then: the notification
// permission alert, Face ID's retry alert after a failure, a notification banner tapped from the background,
// and whether starting the runner while the app is in front sends the app to the background.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { log, open, pause, shot, text, udidOf, waitText } from './common.mts';

const PORT = 8222;
const root = path.resolve(import.meta.dirname, '../ios-xcuitest/build/Build/Products');
const xctestrun = path.join(root, fs.readdirSync(root).find((f) => f.endsWith('.xctestrun'))!);
const base = `http://127.0.0.1:${PORT}`;

async function call(p: string, method = 'GET'): Promise<{ ms: number; result: unknown; wall: number }> {
  const t0 = Date.now();
  const r = await fetch(base + p, { method });
  const j = (await r.json()) as { ms: number; result: unknown };
  return { ...j, wall: Date.now() - t0 };
}

async function startRunner(udid: string): Promise<{ proc: ChildProcess; ms: number }> {
  const t0 = Date.now();
  const proc = spawn('xcodebuild', ['test-without-building', '-xctestrun', xctestrun, '-destination', `id=${udid}`, '-only-testing:Runner/SystemUIServer/testServe'], {
    env: { ...process.env, TEST_RUNNER_QUIESCO_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout!.on('data', (d) => (out += String(d)));
  proc.stderr!.on('data', (d) => (out += String(d)));
  for (;;) {
    const ok = await fetch(`${base}/nodes`).then(() => true, () => false);
    if (ok) return { proc, ms: Date.now() - t0 };
    if (proc.exitCode !== null || Date.now() - t0 > 120_000) throw new Error(`runner did not start:\n${out.slice(-2000)}`);
    await pause(200);
  }
}

const nodes = async (label: string) => {
  const r = await call('/nodes');
  log(label, `nodes ${r.ms}ms (wall ${r.wall}ms):`, JSON.stringify(r.result).slice(0, 900));
  return r.result as { type: string; label: string }[];
};
const tap = async (label: string) => {
  const r = await call(`/tap?label=${encodeURIComponent(label)}`, 'POST');
  log(`tap ${JSON.stringify(label)} → ${String(r.result)} ${r.ms}ms`);
};

// The session picks the booted iPhone 17; start the runner on the same simulator first.
const s0 = Date.now();
const s = await open('ios');
const udid = udidOf(s);
log('session ready', Date.now() - s0, 'ms on', udid);
const info = () => s.driver.request('deviceInfo', {} as never, 3000).then((r) => (r as { appState: string }).appState, (e: Error) => `ERR ${e.message.slice(0, 60)}`);

let runner: ChildProcess | null = null;
try {
  // 1. Start the runner while the app is in front: does the app leave the foreground?
  log('appState before runner', await info());
  const r = await startRunner(udid);
  runner = r.proc;
  log('runner ready after', r.ms, 'ms; appState', await info());
  await shot(s, 'ios-after-runner-start');
  for (const i of [1, 2, 3]) await nodes(`idle #${i}`);

  if (process.env['ONLY_BANNER'] === undefined) {
  // 2. Notification permission alert (cannot be pre-granted on the simulator). An alert left over from an
  // earlier run survives the app's relaunch: answer that one instead of asking again.
  let n1 = (await call('/nodes')).result as { type: string; label: string }[];
  if (!n1.some((n) => n.type === 'alert')) {
    await s.driver.tap('request-notification-permission', { sync: false } as never);
    await pause(1500);
    log('appState with alert', await info());
    n1 = await nodes('permission alert');
  } else log('alert left over from an earlier run');
  await shot(s, 'ios-permission-alert');
  // Labels follow the simulator's language and buttons have no identifiers: the alert's last button allows.
  const allow = n1.filter((n) => n.type === 'button').at(-1);
  if (allow) await tap(allow.label);
  await pause(800);
  log('appState after allow', await info());
  await s.driver.tap('read-notification-permission');
  log('permission now', await waitText(s, 'notification-permission', (t) => t !== ''));

  // 3. Face ID: a failure keeps a retry alert up ("Try Face ID Again" / "Cancel").
  await s.device.biometrics.enroll(true);
  await s.driver.tap('authenticate', { sync: false } as never);
  await pause(1200);
  await s.device.biometrics.fail();
  await pause(1500);
  const n2 = await nodes('after Face ID failure');
  await shot(s, 'ios-faceid-retry');
  const cancel = n2.find((n) => /button/.test(n.type) && /cancel|キャンセル|取消/i.test(n.label));
  if (cancel) await tap(cancel.label);
  log('auth result', await waitText(s, 'auth-result', (t) => t.startsWith('失败') || t === '成功'));

  }
  // 4. A banner while the app is in the background, tapped to open the app.
  await s.device.sendToBackground();
  await s.device.sendNotification({ title: 'spike banner', body: 'tap me' });
  await pause(1500);
  await nodes('banner on the home screen');
  await shot(s, 'ios-banner');
  await tap('spike banner');
  await pause(2000);
  log('appState after banner tap', await info());
  const [el] = await s.driver.request('query', { matcher: { id: 'notification-tapped' }, sync: false } as never, 3000).then((r) => (r as { elements: { text?: string }[] }).elements, () => [] as { text?: string }[]);
  log('notification-tapped text', JSON.stringify(el?.text));
} finally {
  await call('/quit', 'POST').catch(() => undefined);
  runner?.kill();
  await s.device.biometrics.enroll(false).catch(() => undefined);
  await s.dispose();
}
