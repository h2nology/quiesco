// Steps of features/system.feature (Phase 6.7: app.device system integration).
import { Given, Then, When } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';

Given('打开系统集成页', async function (this: QuiescoWorld) {
  await this.app.backdoor('openSystem');
  await this.app.expectVisible('system');
});

When('在设备上录入生物识别', async function (this: QuiescoWorld) {
  await this.app.device.biometrics.enroll();
});

Given('设备已录入生物识别', async function (this: QuiescoWorld) {
  await this.app.device.biometrics.enroll();
});

When('读取录入状态', async function (this: QuiescoWorld) {
  await this.app.tap('read-enrollment');
});

Then('系统集成页显示录入状态 {string}', async function (this: QuiescoWorld, state: string) {
  await this.app.expectText('enrollment', state);
});

When('点击生物识别认证', async function (this: QuiescoWorld) {
  await this.app.tap('authenticate');
});

When('出示匹配的生物特征', async function (this: QuiescoWorld) {
  await this.app.device.biometrics.match();
});

When('出示不匹配的生物特征', async function (this: QuiescoWorld) {
  await this.app.device.biometrics.fail();
});

Then('系统集成页显示认证结果 {string}', async function (this: QuiescoWorld, result: string) {
  await this.app.expectText('auth-result', result);
});

When('摇动设备', async function (this: QuiescoWorld) {
  await this.app.device.shake();
});

Then('系统集成页显示摇动次数 {string}', async function (this: QuiescoWorld, count: string) {
  await this.app.expectText('shake-count', count);
});

// Ask, then allow. (Config `permissions: ['notifications']` would pre-grant them, but the 通知权限尚未决定
// scenarios need the prompt: on iOS only reinstalling the app resets the permission, and a pre-grant
// would follow the reinstall.)
Given('App 可以显示通知', async function (this: QuiescoWorld) {
  await resetNotificationPermission(this);
  await this.app.tap('request-notification-permission');
  await this.app.device.system.allowPermission();
});

When('向 App 发送通知 {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.device.sendNotification({ title, body: `${title}（Quiesco）` });
});

When('从通知栏打开通知 {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.device.openNotification(title);
});

When('预约 3 秒后的本地通知', async function (this: QuiescoWorld) {
  await this.app.tap('schedule-notification');
});

Then('系统集成页显示点击的通知 {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.expectText('notification-tapped', title);
});

Then('系统集成页显示收到的通知 {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.expectText('notification-received', title);
});

Then('系统集成页仍然显示', async function (this: QuiescoWorld) {
  await this.app.expectVisible('system');
});


When('点击系统界面上的 {string}', async function (this: QuiescoWorld, text: string) {
  await this.app.device.system.tap({ text });
});

Then('系统界面显示 {string}', async function (this: QuiescoWorld, text: string) {
  await this.app.device.system.expectVisible({ text });
});

Then('系统界面不再显示 {string}', async function (this: QuiescoWorld, text: string) {
  await this.app.device.system.expectNotVisible({ text });
});

// Web only: the page's confirm / alert stays open until answered (the tap returns once it is up).
When('点击清零摇动次数', async function (this: QuiescoWorld) {
  await this.app.tap('confirm-reset');
});

When('点击显示提示', async function (this: QuiescoWorld) {
  await this.app.tap('show-alert');
});

Then('系统集成页显示对话框结果 {string}', async function (this: QuiescoWorld, result: string) {
  await this.app.expectText('dialog-result', result);
});

// Back to "not determined", as after a fresh install (iOS reinstalls the app; Android kills and restarts
// it), so the page is opened again.
async function resetNotificationPermission(world: QuiescoWorld): Promise<void> {
  await world.app.device.setPermission('notifications', 'reset');
  await world.app.backdoor('openSystem');
  await world.app.expectVisible('system');
}

Given('通知权限尚未决定', async function (this: QuiescoWorld) {
  await resetNotificationPermission(this);
});

When('请求通知权限', async function (this: QuiescoWorld) {
  await this.app.tap('request-notification-permission');
});

When('在系统对话框中允许', async function (this: QuiescoWorld) {
  await this.app.device.system.allowPermission();
});

When('在系统对话框中拒绝', async function (this: QuiescoWorld) {
  await this.app.device.system.denyPermission();
});

Then('系统集成页显示通知权限 {string}', async function (this: QuiescoWorld, status: string) {
  await this.app.expectText('notification-permission', status);
});

// UI that is not React (issues #49–#51): system.* sees other apps', the app's own dialogs and UIKit views.

When('点击系统界面上 id 为 {string} 的按钮', async function (this: QuiescoWorld, id: string) {
  await this.app.device.system.tap({ id });
});

When('在系统界面的 {string} 里输入 {string}', async function (this: QuiescoWorld, field: string, text: string) {
  await this.app.device.system.type({ text: field }, text);
});

When('在屏幕上 \\({int}, {int}\\) 处做一次系统点击', async function (this: QuiescoWorld, x: number, y: number) {
  await this.app.device.system.tapAt({ x, y });
});

When('点击网页登录', async function (this: QuiescoWorld) {
  await this.app.tap('sign-in-web');
});

When('同意 App 使用网站登录', async function (this: QuiescoWorld) {
  // iOS asks first ("<app> Wants to Use <site> to Sign In"); Android opens the page directly.
  if (process.env['QUIESCO_PLATFORM'] === 'ios') await this.app.device.system.tap({ text: 'Continue' });
});

Then('系统集成页显示网页登录结果 {string}', async function (this: QuiescoWorld, result: string) {
  await this.app.expectText('web-auth-result', result);
});

When('点击分享', async function (this: QuiescoWorld) {
  await this.app.tap('share');
});

When('把内嵌日历滚动到屏幕上', async function (this: QuiescoWorld) {
  await this.app.scrollTo('system-scroll', 'inline-date');
});

Then('内嵌日历选中的日期是 {string}', async function (this: QuiescoWorld, date: string) {
  await this.app.expectText('inline-date-value', date);
});

When('打开输入对话框', async function (this: QuiescoWorld) {
  await this.app.scrollTo('system-scroll', 'open-note');
  await this.app.tap('open-note');
  // iOS shows the field on the page, below the button (Android: in a dialog window).
  if (process.env['QUIESCO_PLATFORM'] === 'ios') await this.app.scrollTo('system-scroll', 'note-input');
});

Then('系统集成页显示输入的内容 {string}', async function (this: QuiescoWorld, text: string) {
  await this.app.expectText('note-value', text);
});

