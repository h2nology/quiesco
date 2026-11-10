// 6.7 spike ④: what `dumpsys fingerprint` shows while BiometricPrompt waits for a finger (to wait for it, not sleep).
import { log, open, pause, sh, waitText } from './common.mts';
const adb = (...a: string[]) => sh(`${process.env['HOME']}/Library/Android/sdk/platform-tools/adb`, ['-s', 'emulator-5554', ...a]);
const op = () => adb('shell', 'dumpsys fingerprint').match(/Current operation: .*/g)?.join(' | ') ?? '(none)';
const s = await open('android');
try {
  await s.device.biometrics.enroll();
  log('before tap', op());
  await s.driver.tap('authenticate');
  for (let i = 0; i < 3; i++) {
    log(`+${i * 250}ms`, op());
    await pause(250);
  }
  adb('emu', 'finger', 'touch', '2');
  await pause(Number(process.env['GAP'] ?? 300));
  adb('emu', 'finger', 'touch', '1');
  await pause(1500);
  log('after match', op(), '| result', await waitText(s, 'auth-result', (t) => t !== '…'));
} finally {
  await s.dispose();
}
