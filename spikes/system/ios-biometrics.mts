// 6.7 spike ①: Face ID on the iOS simulator through BiometricKit_Sim notifications (simctl spawn notifyutil).
import { log, open, udidOf, pause, sh, shot, text, waitText } from './common.mts';

const s = await open('ios');
const udid = udidOf(s);
const notify = (...a: string[]) => sh('xcrun', ['simctl', 'spawn', udid, 'notifyutil', ...a]);
const enrollment = async () => {
  await s.driver.tap('read-enrollment');
  return waitText(s, 'enrollment', (t) => t !== '');
};
try {
  log('initial enrollment', await enrollment());
  log('enroll', notify('-s', 'com.apple.BiometricKit.enrollmentChanged', '1'), notify('-p', 'com.apple.BiometricKit.enrollmentChanged'));
  log('after enroll', await enrollment());

  for (const [label, event] of [['match', 'com.apple.BiometricKit_Sim.pearl.match'], ['nomatch', 'com.apple.BiometricKit_Sim.pearl.nomatch']] as const) {
    await s.driver.tap('authenticate');
    await pause(1500);
    await shot(s, `faceid-${label}-prompt`);
    log(label, 'post', notify('-p', event));
    log(label, 'result', await waitText(s, 'auth-result', (t) => t !== '…' && t !== ''));
    await shot(s, `faceid-${label}-after`);
    await pause(1500);
  }

  log('unenroll', notify('-s', 'com.apple.BiometricKit.enrollmentChanged', '0'), notify('-p', 'com.apple.BiometricKit.enrollmentChanged'));
  log('after unenroll', await enrollment());
  log('final auth-result text', await text(s, 'auth-result'));
} finally {
  await s.dispose();
}
