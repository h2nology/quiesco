// 6.7 batch C spike ②: RN AppState and the JS thread while Android's permission dialog (another activity) is up.
import { log, open, pause, sh } from './common.mts';

const adb = (...a: string[]) => sh(`${process.env['HOME']}/Library/Android/sdk/platform-tools/adb`, ['-s', 'emulator-5554', ...a]);
const PKG = 'dev.quiesco.todo';
const s = await open('android');
// The install grants every permission; revoking kills the app, so start it again afterwards.
adb('shell', `pm revoke ${PKG} android.permission.POST_NOTIFICATIONS`);
adb('shell', `pm clear-permission-flags ${PKG} android.permission.POST_NOTIFICATIONS user-set user-fixed`);
await s.device.relaunch();
await s.driver.backdoor('openSystem');
const info = () => s.driver.request('deviceInfo', {} as never, 3000).then((r) => (r as { appState: string }).appState, (e: Error) => `ERR ${e.message.slice(0, 80)}`);
try {
  log('before', await info());
  const t0 = Date.now();
  await s.driver.tap('request-notification-permission', { sync: false } as never);
  log('tap(sync:false) returned', Date.now() - t0, 'ms');
  for (let i = 0; i < 8; i++) {
    log(`+${Date.now() - t0}ms appState`, await info());
    await pause(150);
  }
  // Is a JS timer run while the dialog is up? (backdoor 'spikeTimer' may not exist: evaluate via idle state instead)
  const idle = await s.driver.request('getIdleState', {} as never, 3000).then((r) => JSON.stringify(r).slice(0, 300), (e: Error) => `ERR ${e.message.slice(0, 80)}`);
  log('idle state', idle);
  const top = adb('shell', 'dumpsys activity activities | grep topResumedActivity');
  log('top', top.trim().slice(0, 140));
  const w0 = Date.now();
  const w = await s.driver.request('waitForIdle', { timeoutMs: 2000 } as never, 6000).then((r) => JSON.stringify(r), (e: Error) => `ERR ${e.message.slice(0, 100)}`);
  log('waitForIdle(2000) during dialog:', w, Date.now() - w0, 'ms');
  adb('shell', 'input keyevent KEYCODE_BACK'); // dismiss
  for (let i = 0; i < 4; i++) {
    log(`after back +${Date.now() - t0}ms appState`, await info());
    await pause(150);
  }
  const w1 = Date.now();
  log('waitForIdle after back:', await s.driver.request('waitForIdle', { timeoutMs: 2000 } as never, 6000).then((r) => JSON.stringify(r), (e: Error) => `ERR ${e.message.slice(0, 100)}`), Date.now() - w1, 'ms');
} finally {
  await s.dispose();
}
