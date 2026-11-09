// Phase 6.5 spike ② (iOS cold start with a deep link through `-quiescoUrl`) and ① (native suspend → home
// screen). Needs the dev client rebuilt with the spike's QuiescoNativeModule.swift. Run from examples/todo-app.
import { execFileSync } from 'node:child_process';

import { LAUNCH_PARAM_PORT, LAUNCH_PARAM_SESSION } from '@quiesco/protocol';
import { IOS_DEV_MENU_ARGS, Session } from '@quiesco/core';

const bundle = 'dev.quiesco.todo';
const metroUrl = process.env['QUIESCO_METRO_URL'] ?? 'http://localhost:8083';
const simctl = (...a: string[]): string => execFileSync('xcrun', ['simctl', ...a]).toString().trim();
const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);
const within = <T,>(p: Promise<T>, ms: number): Promise<unknown> =>
  Promise.race([p.then((v) => ['ok', v], (e: Error) => ['error', e.message]), new Promise((r) => setTimeout(() => r([`no answer in ${ms} ms`]), ms))]);
const pid = (): string => /(\d+)\s+\S+\s+UIKitApplication:dev\.quiesco\.todo/.exec(simctl('spawn', 'booted', 'launchctl', 'list'))?.[1] ?? 'not running';
const frontmost = (): string => {
  const out = simctl('spawn', 'booted', 'launchctl', 'list');
  return out.includes('UIKitApplication:com.apple.Preferences') ? 'Settings running' : 'Settings not running';
};

const session = await Session.create({
  platform: 'ios',
  config: { apps: { ios: { bundleId: bundle, devClient: { metroUrl } } }, devices: { ios: {} }, logLevel: 'warn' } as never,
});
const app = session.driver;
const { port, sessionId } = session.launchParams;
try {
  log('normal launch:', await app.backdoor('lifecycleInfo'), 'playground?', (await app.query({ id: 'playground' })).length > 0);

  // ② cold start with -quiescoUrl
  const t0 = Date.now();
  simctl('launch', '--terminate-running-process', 'booted', bundle, '--initialUrl', metroUrl, ...IOS_DEV_MENU_ARGS,
    `-${LAUNCH_PARAM_PORT}`, String(port), `-${LAUNCH_PARAM_SESSION}`, sessionId, '-quiescoUrl', 'quiescotodo://playground');
  // The old connection closes a moment after the relaunch; retry until the new one answers.
  let info: unknown;
  for (;;) {
    try { info = await app.backdoor('lifecycleInfo'); break; } catch (e) { if ((e as { errorName?: string }).errorName !== 'AGENT_DISCONNECTED') throw e; }
  }
  log('② -quiescoUrl cold start: connected after', Date.now() - t0, 'ms;', info, 'playground?', (await app.query({ id: 'playground' })).length > 0);

  // ① native suspend → home screen, then simctl launch (no terminate)
  const p0 = pid();
  log('① spikeSuspend:', JSON.stringify(await within(app.backdoor('spikeSuspend'), 3000)), frontmost());
  log('① getIdleState right after:', JSON.stringify(await within(app.getIdleState(), 3000)));
  const png = simctl('io', 'booted', 'screenshot', '--type=png', `${process.env['SPIKE_OUT'] ?? '/tmp'}/ios-after-suspend.png`);
  log('① screenshot:', png.split('\n').at(-1));
  simctl('launch', 'booted', bundle);
  log('① foreground: same pid?', pid() === p0, JSON.stringify(await within(app.backdoor('lifecycleInfo'), 15000)));
} finally {
  await session.dispose();
}
