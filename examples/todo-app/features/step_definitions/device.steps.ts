// Steps of features/device.feature (Phase 6.6: app.device device state).
import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';

/** The page again, e.g. after the system killed the app (Android revoke) or a locale relaunch. */
async function openDevicePage(world: QuiescoWorld): Promise<void> {
  const [shown] = await world.app.query({ id: 'device' }, { sync: true });
  if (shown !== undefined) return;
  await world.app.backdoor('openDevice');
  await world.app.expectVisible('device');
}

/** Orientation when the page was first opened, before any scenario rotated the device (phone: portrait, desktop: landscape). */
let initialOrientation: string | null = null;

Given('打开设备状态页', async function (this: QuiescoWorld) {
  await this.app.backdoor('openDevice');
  await this.app.expectVisible('device');
  initialOrientation ??= (await this.app.attributes('orientation')).text;
});

When('把设备转到横屏', async function (this: QuiescoWorld) {
  await this.app.device.setOrientation('landscape');
});

When('把设备切换到深色模式', async function (this: QuiescoWorld) {
  await this.app.device.setAppearance('dark');
});

When('把系统字号设为 {float} 倍', async function (this: QuiescoWorld, scale: number) {
  await this.app.device.setFontScale(scale);
  await openDevicePage(this); // Android starts the app again
});

When('把 App 的语言设为 {string}', async function (this: QuiescoWorld, locale: string) {
  await this.app.device.setLocale(locale);
  await openDevicePage(this);
});

When('把设备位置设为北纬 {float}、东经 {float}', async function (this: QuiescoWorld, lat: number, lon: number) {
  await this.app.device.setLocation(lat, lon);
});

When('撤销 App 的定位权限', async function (this: QuiescoWorld) {
  await this.app.device.setPermission('location', 'revoke');
  await openDevicePage(this);
});

When('读取位置', async function (this: QuiescoWorld) {
  await this.app.tap('read-location');
});

Then('设备状态页显示方向 {string}', async function (this: QuiescoWorld, orientation: string) {
  await this.app.expectText('orientation', orientation);
});

Then('设备状态页的方向与开始时相同', async function (this: QuiescoWorld) {
  assert.ok(initialOrientation !== null, 'the device page was never opened');
  await this.app.expectText('orientation', initialOrientation);
});

Then('设备状态页显示外观 {string}', async function (this: QuiescoWorld, scheme: string) {
  await this.app.expectText('color-scheme', scheme);
});

Then('设备状态页显示的字号倍数大于 {float}', async function (this: QuiescoWorld, min: number) {
  const el = await this.app.attributes('font-scale');
  assert.ok(Number(el.text) > min, `font scale ${el.text}`);
});

Then('设备状态页显示的语言是日语', async function (this: QuiescoWorld) {
  await this.app.expectText('locale', /^ja\b/);
});

Then('设备状态页显示位置 {string}', async function (this: QuiescoWorld, position: string) {
  await this.app.expectText('position', position);
});

When('把设备切换到离线', async function (this: QuiescoWorld) {
  await this.app.device.setNetwork('offline');
});

When('把设备切换到在线', async function (this: QuiescoWorld) {
  await this.app.device.setNetwork('online');
});

When('发送请求', async function (this: QuiescoWorld) {
  await this.app.tap('send-request');
});

Then('设备状态页显示请求结果 {string}', async function (this: QuiescoWorld, result: string) {
  await this.app.expectText('request-result', result);
});

Then('设备状态页显示网络 {string}', async function (this: QuiescoWorld, state: string) {
  await this.app.expectText('net-state', state);
});

When('把剪贴板设为 {string}', async function (this: QuiescoWorld, text: string) {
  await this.app.device.clipboard.set(text);
});

When('读取剪贴板', async function (this: QuiescoWorld) {
  await this.app.tap('read-clipboard');
});

Then('设备状态页显示剪贴板 {string}', async function (this: QuiescoWorld, text: string) {
  await this.app.expectText('clipboard-text', text);
});

When('在 App 里点击复制', async function (this: QuiescoWorld) {
  await this.app.tap('copy-text');
  await this.app.expectText('clipboard-text', '已复制'); // written (asynchronously) by then
});

Then('剪贴板内容是 {string}', async function (this: QuiescoWorld, text: string) {
  assert.equal(await this.app.device.clipboard.get(), text);
});

When('把状态栏设为 9:41、满电、信号满格', async function (this: QuiescoWorld) {
  await this.app.device.setStatusBar({ time: '9:41', batteryLevel: 100, charging: false, wifiBars: 3, cellularBars: 4 });
});

Then('截图附到报告', async function (this: QuiescoWorld) {
  const png = await this.app.device.screenshot();
  assert.ok(png.length > 0);
  this.attach(png, 'image/png');
});
