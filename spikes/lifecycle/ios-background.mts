// Phase 6.5 spike ① on iOS: background by opening another app, foreground with `simctl launch`
// (no --terminate-running-process). Does the process / connection survive, does AppState change?
import { execFileSync } from 'node:child_process';
import { Session } from '@quiesco/core';

const bundle = 'dev.quiesco.todo';
const simctl = (...a: string[]): string => execFileSync('xcrun', ['simctl', ...a]).toString().trim();
const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);
const within = <T,>(p: Promise<T>, ms: number): Promise<unknown> =>
  Promise.race([p.then((v) => ['ok', v], (e: Error) => ['error', e.message]), new Promise((r) => setTimeout(() => r([`no answer in ${ms} ms`]), ms))]);
const pid = (): string => /(\d+)\s+\S+\s+UIKitApplication:dev\.quiesco\.todo/.exec(simctl('spawn', 'booted', 'launchctl', 'list'))?.[1] ?? 'not running';
const bgSeconds = Number(process.argv[2] ?? 20);

const session = await Session.create({
  platform: 'ios',
  config: { apps: { ios: { bundleId: bundle, devClient: { metroUrl: process.env['QUIESCO_METRO_URL'] ?? 'http://localhost:8083' } } }, devices: { ios: {} }, logLevel: 'warn' } as never,
});
const app = session.driver;
try {
  const p0 = pid();
  log('launched, pid', p0, await app.backdoor('lifecycleInfo'));
  simctl('launch', 'booted', 'com.apple.Preferences');
  log('Settings opened; getIdleState:', JSON.stringify(await within(app.getIdleState(), 3000)));
  await new Promise((r) => setTimeout(r, bgSeconds * 1000)); // spike only: how long does the connection survive?
  log(`after ${bgSeconds}s in background; pid`, pid(), 'getIdleState:', JSON.stringify(await within(app.getIdleState(), 3000)));
  const out = simctl('launch', 'booted', bundle);
  log('simctl launch (no terminate):', out, 'pid', pid(), 'same?', pid() === p0);
  log('after foreground:', JSON.stringify(await within(app.backdoor('lifecycleInfo'), 15000)));
} finally {
  await session.dispose();
}
