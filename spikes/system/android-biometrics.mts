// 6.7 spike ②: Android fingerprint — enroll through Settings (uiautomator), then match / no match in the app.
import { log, open, pause, sh, shot, text, waitText } from './common.mts';

const adb = (...a: string[]) => sh(`${process.env['HOME']}/Library/Android/sdk/platform-tools/adb`, ['-s', 'emulator-5554', ...a]);
const shell = (cmd: string) => adb('shell', cmd);
const PIN = '1111';

/** Center of the first enabled node whose text is `label` (case-insensitive), or null. */
function find(label: string): string | null {
  shell('uiautomator dump /sdcard/ui.xml');
  const xml = shell('cat /sdcard/ui.xml');
  for (const m of xml.matchAll(/<node ([^>]*)>/g)) {
    const attrs = Object.fromEntries([...(m[1] as string).matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    if ((attrs['text'] ?? '').toLowerCase() === label.toLowerCase() && attrs['enabled'] === 'true') {
      const [x1, y1, x2, y2] = (attrs['bounds'] as string).match(/\d+/g)!.map(Number);
      return `${(x1! + x2!) >> 1} ${(y1! + y2!) >> 1}`;
    }
  }
  return null;
}
const titles = () => {
  shell('uiautomator dump /sdcard/ui.xml');
  return [...shell('cat /sdcard/ui.xml').matchAll(/text="([^"]+)"/g)].map((m) => m[1]).slice(0, 4).join(' | ');
};

async function enroll(): Promise<void> {
  log('set-pin', shell(`locksettings set-pin ${PIN}`));
  shell('am start -W -a android.settings.FINGERPRINT_ENROLL');
  await pause(1000);
  shell(`input text ${PIN}`);
  shell('input keyevent 66');
  await pause(1500);
  for (let i = 0; i < 6; i++) {
    const more = find('MORE');
    if (more === null) break;
    shell(`input tap ${more}`);
    await pause(500);
  }
  const agree = find('I AGREE');
  log('agree at', agree);
  if (agree !== null) shell(`input tap ${agree}`);
  await pause(1500);
  for (let i = 0; i < 10 && find('DONE') === null; i++) {
    adb('emu', 'finger', 'touch', '1');
    await pause(800);
  }
  log('screen', titles());
  const done = find('DONE');
  if (done !== null) shell(`input tap ${done}`);
  log('prints', shell('dumpsys fingerprint').match(/"count":\d+/)?.[0]);
}

const s = await open('android');
try {
  await enroll();
  await s.device.bringToForeground().catch(() => undefined);
  shell('am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n dev.quiesco.todo/.MainActivity');
  await pause(1500);
  await s.driver.tap('read-enrollment');
  log('enrollment', await waitText(s, 'enrollment', (t) => t !== ''));

  await s.driver.tap('authenticate');
  await pause(1500);
  await shot(s, 'android-prompt');
  log('prompt', titles());
  adb('emu', 'finger', 'touch', '1');
  log('match result', await waitText(s, 'auth-result', (t) => t !== '…'));

  await s.driver.tap('authenticate');
  await pause(1500);
  for (let i = 1; i <= 6; i++) {
    adb('emu', 'finger', 'touch', '2');
    await pause(1500);
    const r = await text(s, 'auth-result');
    log(`after unknown finger #${i}`, r, '|', titles());
    if (r !== '…') break;
  }
  await shot(s, 'android-nomatch');
  const cancel = find('Cancel');
  log('cancel button', cancel);
  if (cancel !== null) {
    shell(`input tap ${cancel}`);
    log('after cancel', await waitText(s, 'auth-result', (t) => t !== '…'));
  }
} finally {
  log('clear', shell(`locksettings clear --old ${PIN}`), shell('dumpsys fingerprint').match(/"count":\d+/)?.[0]);
  await s.dispose();
}
