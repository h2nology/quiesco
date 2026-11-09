// Steps of features/lifecycle.feature (Phase 6.5: app.device.* / app.sync.*).
import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import { decodePng } from '@quiesco/core';
import type { RelaunchOptions } from '@quiesco/core';
import type { QuiescoWorld } from '@quiesco/cucumber';

const LIFECYCLE_URL = 'quiescotodo://lifecycle';

type LifecycleWorld = QuiescoWorld & { screenshot?: Buffer };

Given('打开生命周期页', async function (this: QuiescoWorld) {
  await this.app.backdoor('openLifecycle');
  await this.app.expectVisible('lifecycle');
});

When('以启动参数 {string} 重新启动 App 并打开生命周期页', async function (this: QuiescoWorld, json: string) {
  await this.app.device.relaunch({ args: JSON.parse(json) as NonNullable<RelaunchOptions['args']>, url: LIFECYCLE_URL });
  await this.app.expectVisible('lifecycle');
});

When('重新启动 App 并打开生命周期页', async function (this: QuiescoWorld) {
  await this.app.device.relaunch({ url: LIFECYCLE_URL });
  await this.app.expectVisible('lifecycle');
});

When('清除数据后重新启动 App 并打开生命周期页', async function (this: QuiescoWorld) {
  await this.app.device.relaunch({ url: LIFECYCLE_URL, clearData: true });
  await this.app.expectVisible('lifecycle');
});

Then('页面显示的启动参数是 {string}', async function (this: QuiescoWorld, json: string) {
  await this.app.expectText('launch-args', json);
});

When('点击访问 +1 共 {int} 次', async function (this: QuiescoWorld, n: number) {
  for (let i = 0; i < n; i++) await this.app.tap('add-visit');
});

Then('访问计数是 {string}', async function (this: QuiescoWorld, n: string) {
  await this.app.expectText('visits', n);
});

When('把 App 切到后台', async function (this: QuiescoWorld) {
  await this.app.device.sendToBackground();
});

When('把 App 切回前台', async function (this: QuiescoWorld) {
  await this.app.device.bringToForeground();
});

When('结束 App', async function (this: QuiescoWorld) {
  await this.app.device.terminate();
});

Then('操作页面会失败，原因是 {string}', async function (this: QuiescoWorld, errorName: string) {
  await assert.rejects(this.app.tap('add-visit'), (e: { errorName?: string }) => e.errorName === errorName);
});

Then('App 状态记录经过了 {string}，现在是 {string}', async function (this: QuiescoWorld, passed: string, now: string) {
  const [el] = await this.app.expectVisible('app-states');
  const states = (el?.text ?? '').split(' → ');
  assert.ok(states.includes(passed), `AppState history: ${el?.text}`);
  assert.equal(states.at(-1), now, `AppState history: ${el?.text}`);
});

When('关闭定时器同步，并忽略轮询计数的变化', async function (this: QuiescoWorld) {
  await this.app.sync.disableTracker('timer');
  await this.app.sync.ignoreElements.add('poll-count');
});

When('开始轮询', async function (this: QuiescoWorld) {
  await this.app.tap('toggle-poll');
});

When('停止轮询', async function (this: QuiescoWorld) {
  await this.app.tap('toggle-poll');
});

Then('轮询仍在进行', async function (this: QuiescoWorld) {
  await this.app.expectText('toggle-poll', '停止轮询');
  await this.app.expect({ id: 'poll-count' }).not.toHaveText('0');
});

When('截取红色方块的截图', async function (this: LifecycleWorld) {
  this.screenshot = await this.app.device.screenshot('red-box');
});

Then('截图的宽高比是 {int}:{int}，中心是红色', function (this: LifecycleWorld, w: number, h: number) {
  assert.ok(this.screenshot !== undefined, 'no screenshot taken');
  const img = decodePng(this.screenshot);
  assert.ok(Math.abs(img.width / img.height - w / h) < 0.05, `screenshot is ${img.width}×${img.height}`);
  const at = (Math.floor(img.height / 2) * img.width + Math.floor(img.width / 2)) * img.channels;
  const [r, g, b] = [img.pixels[at], img.pixels[at + 1], img.pixels[at + 2]] as [number, number, number];
  assert.ok(r > 230 && g < 30 && b < 30, `center pixel is rgb(${r}, ${g}, ${b})`);
});
