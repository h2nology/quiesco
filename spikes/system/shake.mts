// 6.7 spike ③: shake reaching react-native-shake. iOS: @quiesco/native `shake` (private motion events).
// Android: accelerometer through the emulator console (`adb emu sensor set acceleration x:y:z`).
import { log, open, pause, sh, shot, text, udidOf } from './common.mts';

const platform = (process.argv[2] ?? 'ios') as 'ios' | 'android';
const adb = (...a: string[]) => sh(`${process.env['HOME']}/Library/Android/sdk/platform-tools/adb`, ['-s', 'emulator-5554', ...a]);
const s = await open(platform);
try {
  log('count before', await text(s, 'shake-count'));
  if (platform === 'ios') {
    await s.device.shake();
  } else {
    // Alternating strong pushes along x, then rest (gravity on y).
    // react-native-shake: 8 sign changes above 1.33 g within 3 s (samples >= 20 ms apart).
    for (const v of [...Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? '20:9.8:0' : '-20:9.8:0')), '0:9.8:0']) {
      log('accel', v, adb('emu', 'sensor', 'set', 'acceleration', v));
      await pause(80);
    }
  }
  await pause(1500);
  log('count after', await text(s, 'shake-count'));
  await shot(s, `shake-${platform}-after`);
} finally {
  await s.dispose();
}
