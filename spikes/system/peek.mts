// Spike diagnostics: tap the system page's first button now, after a pause, and in js mode.
import { log, open, pause, text } from './common.mts';
const s = await open((process.argv[2] ?? 'ios') as 'ios');
const attempt = async (label: string, mode?: 'js') => {
  try {
    await s.driver.tap('read-enrollment', mode === undefined ? {} : ({ mode } as never));
    log(label, 'ok', await text(s, 'enrollment'));
  } catch (e) {
    log(label, 'FAIL', (e as Error).message);
  }
};
try {
  await attempt('immediate');
  await pause(2000);
  await attempt('after 2s');
  await attempt('js mode', 'js');
  log('attributes', JSON.stringify(await s.driver.attributes('read-enrollment')));
} finally {
  await s.dispose();
}
