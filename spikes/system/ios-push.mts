// 6.7 batch B spike ①: simctl push — app in front, app in the background, without notification permission.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { log, open, pause, sh, shot, text, udidOf, waitText } from './common.mts';

const s = await open('ios');
const udid = udidOf(s);
const push = (title: string) => {
  const file = path.join(os.tmpdir(), `quiesco-push-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ aps: { alert: { title, body: `${title} body` }, sound: 'default' }, extra: { from: 'quiesco' } }));
  const out = sh('xcrun', ['simctl', 'push', udid, 'dev.quiesco.todo', file]);
  fs.rmSync(file);
  return out;
};
try {
  await s.driver.tap('read-notification-permission');
  log('permission', await waitText(s, 'notification-permission', (t) => t !== ''));

  log('push (front)', push('Front 1'));
  log('received', await waitText(s, 'notification-received', (t) => t !== ''));
  await shot(s, 'push-front');

  await s.device.sendToBackground();
  await pause(1000);
  log('push (background)', push('Back 1'));
  await pause(1500);
  await shot(s, 'push-background');
  await s.device.bringToForeground();
  log('after foreground: received', await text(s, 'notification-received'), '| tapped', await text(s, 'notification-tapped'));
} finally {
  await s.dispose();
}
