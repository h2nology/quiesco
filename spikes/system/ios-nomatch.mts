// 6.7 spike ①b: how many Face ID nomatch events until authenticateAsync fails (disableDeviceFallback: true).
import { log, open, udidOf, pause, sh, shot, text } from './common.mts';

const s = await open('ios');
const udid = udidOf(s);
const notify = (...a: string[]) => sh('xcrun', ['simctl', 'spawn', udid, 'notifyutil', ...a]);
try {
  notify('-s', 'com.apple.BiometricKit.enrollmentChanged', '1');
  notify('-p', 'com.apple.BiometricKit.enrollmentChanged');
  await s.driver.tap('authenticate');
  await pause(1500);
  for (let i = 1; i <= 4; i++) {
    notify('-p', 'com.apple.BiometricKit_Sim.pearl.nomatch');
    await pause(2500);
    const r = await text(s, 'auth-result');
    log(`after nomatch #${i}`, r);
    await shot(s, `nomatch-${i}`);
    if (r !== '…') break;
  }
} finally {
  await s.dispose();
}
