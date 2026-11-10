// 6.7 batch C spike ①: Android system dialogs through uiautomator — the notification permission dialog
// (structure, sync while it is up, deny / ask again / allow) and BiometricPrompt's cancel after a failure.
import { log, open, pause, sh, shot, text, waitText } from './common.mts';

const adb = (...a: string[]) => sh(`${process.env['HOME']}/Library/Android/sdk/platform-tools/adb`, ['-s', 'emulator-5554', ...a]);
const shell = (c: string) => adb('shell', c);
const PKG = 'dev.quiesco.todo';

interface Node { text: string; id: string; pkg: string; cls: string; clickable: boolean; bounds: number[] }
function dump(): { nodes: Node[]; ms: number } {
  const t0 = Date.now();
  shell('uiautomator dump /sdcard/ui.xml');
  const xml = shell('cat /sdcard/ui.xml');
  const nodes: Node[] = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const a = Object.fromEntries([...(m[1] as string).matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(a['bounds'] ?? '');
    nodes.push({ text: a['text'] ?? '', id: a['resource-id'] ?? '', pkg: a['package'] ?? '', cls: (a['class'] ?? '').split('.').pop() ?? '', clickable: a['clickable'] === 'true', bounds: b ? b.slice(1).map(Number) : [] });
  }
  return { nodes, ms: Date.now() - t0 };
}
const outside = (ns: Node[]) => ns.filter((n) => n.pkg !== PKG && (n.text !== '' || n.id !== ''));
const show = (label: string) => {
  const { nodes, ms } = dump();
  log(label, `dump ${ms}ms, packages:`, [...new Set(nodes.map((n) => n.pkg))].join(','));
  for (const n of outside(nodes)) log('   ', n.pkg, n.cls, JSON.stringify(n.text), n.id, n.clickable ? 'clickable' : '', n.bounds.join(','));
  return nodes;
};
const tapNode = (n: Node) => shell(`input tap ${(n.bounds[0]! + n.bounds[2]!) >> 1} ${(n.bounds[1]! + n.bounds[3]!) >> 1}`);
// Revoking a runtime permission kills the app: start it again on the system page.
const resetNotifPerm = async () => {
  shell(`pm revoke ${PKG} android.permission.POST_NOTIFICATIONS`);
  shell(`pm clear-permission-flags ${PKG} android.permission.POST_NOTIFICATIONS user-set user-fixed`);
  await s.device.relaunch();
  await s.driver.backdoor('openSystem');
  await s.driver.expectVisible('system');
};

const s = await open('android');
try {
  await resetNotifPerm();
  log('flags after reset:', shell(`dumpsys package ${PKG} | grep POST_NOTIFICATIONS`).replace(/\s+/g, ' '));

  // 1. Request → dialog. Does tap() (which waits for idle) return while the dialog is up?
  let t0 = Date.now();
  await s.driver.tap('request-notification-permission', { sync: false } as never);
  log('tap(request) returned after', Date.now() - t0, 'ms');
  await pause(800);
  let nodes = show('dialog #1');
  await shot(s, 'android-perm-dialog');

  const deny = nodes.find((n) => /deny/i.test(n.id));
  log('deny node', deny?.id, JSON.stringify(deny?.text));
  if (deny) tapNode(deny);
  log('after deny:', await waitText(s, 'notification-permission', (t) => t !== ''));

  // 2. Ask again: Android shows the dialog a second time? (after two denials it stops)
  await s.driver.tap('request-notification-permission', { sync: false } as never);
  await pause(800);
  nodes = show('dialog #2');
  const allow = nodes.find((n) => /allow_button$/.test(n.id));
  log('allow node', allow?.id, JSON.stringify(allow?.text));
  if (allow) tapNode(allow);
  log('after allow:', await waitText(s, 'notification-permission', (t) => t === 'granted'));

  // 3. Two denials → no dialog any more?
  await resetNotifPerm();
  for (const i of [1, 2, 3]) {
    await s.driver.tap('request-notification-permission', { sync: false } as never);
    await pause(800);
    const d = dump().nodes.find((n) => /deny/i.test(n.id));
    log(`deny round ${i}: dialog`, d !== undefined);
    if (d) tapNode(d);
    await pause(500);
  }
  log('flags after denials:', shell(`dumpsys package ${PKG} | grep POST_NOTIFICATIONS`).replace(/\s+/g, ' '));
  await resetNotifPerm();

  // 4. BiometricPrompt: fail, then the prompt's cancel button.
  await s.device.biometrics.enroll(true);
  await s.driver.tap('authenticate', { sync: false } as never);
  await s.device.biometrics.fail();
  await pause(1000);
  nodes = show('biometric prompt after fail');
  await shot(s, 'android-bio-after-fail');
  const cancel = nodes.find((n) => n.text === '取消');
  log('cancel node', cancel?.pkg, cancel?.id);
  if (cancel) tapNode(cancel);
  log('auth result:', await waitText(s, 'auth-result', (t) => t.startsWith('失败')));
  log('app text check', await text(s, 'notification-permission'));
} finally {
  await s.device.biometrics.enroll(false).catch((e: Error) => log('unenroll', e.message));
  await s.dispose();
}
