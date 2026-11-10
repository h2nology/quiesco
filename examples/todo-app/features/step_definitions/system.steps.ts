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

Given('App 可以显示通知', async function (this: QuiescoWorld) {
  await this.app.device.setPermission('notifications', 'grant');
});

When('向 App 发送通知 {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.device.sendNotification({ title, body: `${title}（Quiesco）` });
});

When('从通知栏打开通知 {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.device.openNotification(title);
});

Then('系统集成页显示收到的通知 {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.expectText('notification-received', title);
});

Then('系统集成页仍然显示', async function (this: QuiescoWorld) {
  await this.app.expectVisible('system');
});

