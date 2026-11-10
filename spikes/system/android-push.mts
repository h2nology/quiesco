// 6.7 batch B spike ②: Android notification delivery — A: a notification posted as the app (NotificationManager),
// B: an FCM message handed to expo-notifications. In front and in the background; tapped in the shade.
import { log, open, pause, sh, shot, text, waitText } from './common.mts';

const adb = (...a: string[]) => sh(`${process.env['HOME']}/Library/Android/sdk/platform-tools/adb`, ['-s', 'emulator-5554', ...a]);
const shell = (c: string) => adb('shell', c);
const s = await open('android');
// Agent calls that also work while the app is in the background (driver.backdoor refuses then).
const backdoor = (name: string, ...args: unknown[]) => s.driver.request('backdoor', { name, args } as never, 10_000).then((r) => (r as { value: unknown }).value, (e: Error) => `ERR ${e.message}`);
const fcm = (title: string) => ({ 'google.message_id': `m-${Date.now()}`, 'gcm.notification.title': title, 'gcm.notification.body': `${title} body`, from: 'quiesco', screen: 'system' });
const posted = (title: string) => shell('dumpsys notification --noredact').includes(title);

function tapInShade(title: string): boolean {
  shell('cmd statusbar expand-notifications');
  shell('uiautomator dump /sdcard/ui.xml');
  const xml = shell('cat /sdcard/ui.xml');
  const m = new RegExp(`text="${title}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`).exec(xml);
  if (m === null) {
    shell('cmd statusbar collapse');
    return false;
  }
  shell(`input tap ${(Number(m[1]) + Number(m[3])) >> 1} ${(Number(m[2]) + Number(m[4])) >> 1}`);
  return true;
}

try {
  await s.provider.grantPermissions(['notifications']);
  await s.driver.tap('read-notification-permission');
  log('permission', await waitText(s, 'notification-permission', (t) => t !== ''));

  log('A front', JSON.stringify(await backdoor('spikePostNotification', 'A front', { screen: 'system' })));
  await pause(1000);
  log('A front: posted', posted('A front'), '| received', await text(s, 'notification-received'));

  log('B front', JSON.stringify(await backdoor('spikeDeliverPush', fcm('B front'))));
  log('B front: received', await waitText(s, 'notification-received', (t) => t === 'B front'), '| posted', posted('B front'));
  await shot(s, 'android-b-front');

  for (const [label, call] of [
    ['B back', () => backdoor('spikeDeliverPush', fcm('B back'))],
    ['A back', () => backdoor('spikePostNotification', 'A back', { screen: 'system' })],
  ] as const) {
    await s.device.sendToBackground();
    await pause(800);
    log(label, JSON.stringify(await call()));
    await pause(1200);
    log(label, 'posted', posted(label));
    const tapped = tapInShade(label);
    log(label, 'tapped in shade', tapped);
    await pause(2500);
    log(label, 'resumed:', shell('dumpsys activity activities').match(/topResumedActivity=\S+ \S+ (\S+)/)?.[1]);
    (s as unknown as { appState: string }).appState = 'running';
    log(label, 'tapped text', await text(s, 'notification-tapped'), '| received', await text(s, 'notification-received'));
    await shot(s, `android-${label.replace(' ', '-')}`);
  }
} finally {
  await s.dispose();
}
