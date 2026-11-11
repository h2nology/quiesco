// 6.10 spike: does the network tracker see each kind of request (Detox #4973)? For every kind, start
// one 1.5 s request in the app (temporary `netProbe` backdoor), then look at the idle state at once and
// time waitForIdle: ~1.5 s = tracked, ~0 = blind.
// Usage: node spikes/network/network.mts ios|android|web   (Metro on QUIESCO_METRO_URL, default :8083)
// The temporary netProbe / netProbeResult / netProbeState backdoors it used were removed with the implementation (Phase 6.10).
import path from 'node:path';

import { Session } from '@quiesco/core';
import type { Platform } from '@quiesco/protocol';

import { log, pause } from '../system/common.mts';
import { startSpikeServer } from './server.mjs';

const platform = (process.argv[2] ?? 'ios') as Platform;
const PORT = 3011;
const MS = 1500;
const app = path.resolve(import.meta.dirname, '../../examples/todo-app');
const metroUrl = process.env['QUIESCO_METRO_URL'] ?? 'http://localhost:8083';

const srv = await startSpikeServer(PORT);
const apps = {
  ios: { bundleId: 'dev.quiesco.todo', binaryPath: path.join(app, 'ios/build/Build/Products/Debug-iphonesimulator/QuiescoTodo.app'), devClient: { metroUrl } },
  android: { package: 'dev.quiesco.todo', binaryPath: path.join(app, 'android/app/build/outputs/apk/debug/app-debug.apk'), devClient: { scheme: 'quiescotodo', metroUrl }, reversePorts: [PORT] },
  web: { url: metroUrl },
};
const s = await Session.create({
  platform,
  config: { apps: { [platform]: apps[platform] }, devices: { ios: { device: 'iPhone 17', os: '26.5' }, android: {}, web: { browser: 'chromium' } }, logLevel: process.env['SPIKE_LOG'] ?? 'warn', connectTimeoutMs: 120_000 } as never,
});

const base = `http://localhost:${PORT}`;
const cases: [string, string][] = [
  ['global-fetch', `${base}/headers-slow?ms=${MS}`],
  ['global-fetch-body', `${base}/body-slow?ms=${MS}`],
  ['expo-fetch', `${base}/headers-slow?ms=${MS}`],
  ['expo-fetch-body', `${base}/body-slow?ms=${MS}`],
  ['xhr', `${base}/headers-slow?ms=${MS}`],
  ['ws', `ws://localhost:${PORT}/ws?ms=${MS}`],
  ['sse', `${base}/sse?ms=${MS}`],
];

try {
  await s.driver.waitForIdle({ timeoutMs: 30_000 });
  // The agent waits for idle before answering a backdoor call (runtime.ts), so the call's duration is
  // the measurement: ~1.5 s = the request was tracked to its end, ~0 = not tracked (or ended early).
  for (const [name, url] of cases) {
    const kind = name.replace(/-body$/, '');
    const t0 = Date.now();
    const info = (await s.driver.backdoor('netProbe', kind, url)) as Record<string, unknown>;
    const waited = Date.now() - t0;
    const st = (await s.driver.backdoor('netProbeState')) as { trace: string[] };
    let result = '';
    for (let i = 0; i < 40; i++) {
      result = String(await s.driver.backdoor('netProbeResult', kind));
      if (result !== 'pending') break;
      await pause(100);
    }
    const trace = st.trace.map((l) => l.split(' at ')[0]?.trim()).join(' ; ');
    log(`${platform} ${name.padEnd(18)} sync-wait=${String(waited).padStart(5)}ms  done=${result}  tracker=[${trace}]`);
    if (name === 'global-fetch') log('  globals', JSON.stringify({ fetchName: info['fetchName'], fetchIsExpo: info['fetchIsExpo'], getter: info['fetchDescriptorGetter'], eventSource: info['eventSource'], expoFetchExport: info['expoFetchExport'] }));
  }
} finally {
  await s.dispose();
  await srv.close();
}
