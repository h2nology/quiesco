// Steps of features/screenshots.feature (Phase 6.9: app.device.screenshot).
import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import { pngSize } from '@quiesco/core';
import type { QuiescoWorld } from '@quiesco/cucumber';

type ShotWorld = QuiescoWorld & { shot?: Buffer; screen?: { width: number; height: number } };

const screenSize = async (w: QuiescoWorld) => pngSize(await w.app.device.screenshot());
/** Screenshot pixels per window unit: the screen's PNG width / the window width. */
const scale = async (w: QuiescoWorld): Promise<number> => (await screenSize(w)).width / (await w.app.attributes({ id: 'todos-screen' })).rect!.width;

Given('待办列表中有 {int} 条待办', async function (this: QuiescoWorld, n: number) {
  await this.app.backdoor('seedTodos', Array.from({ length: n }, (_, i) => `待办 ${i + 1}`));
});

When('截取当前屏幕，命名为 {string}', async function (this: ShotWorld, name: string) {
  this.shot = await this.app.device.screenshot(undefined, { name });
});

Then('截图和屏幕一样大', async function (this: ShotWorld) {
  assert.deepEqual(pngSize(this.shot!), await screenSize(this));
});

When('截取 {string} 的截图，命名为 {string}', async function (this: ShotWorld, id: string, name: string) {
  this.shot = await this.app.device.screenshot(id, { name });
});

Then('截图和 {string} 一样大', async function (this: ShotWorld, id: string) {
  const rect = (await this.app.attributes(id)).rect!;
  const s = await scale(this);
  const size = pngSize(this.shot!);
  assert.ok(Math.abs(size.width - rect.width * s) <= 2 && Math.abs(size.height - rect.height * s) <= 2, `${size.width}×${size.height} vs ${rect.width * s}×${rect.height * s}`);
});

When('截取整页截图，命名为 {string}', async function (this: ShotWorld, name: string) {
  this.screen = await screenSize(this);
  this.shot = await this.app.device.screenshot({ fullPage: true }, { name });
});

Then('整页截图比屏幕长得多', function (this: ShotWorld) {
  const size = pngSize(this.shot!);
  assert.equal(size.width, this.screen!.width);
  assert.ok(size.height > this.screen!.height * 1.5, `full page ${size.height} px, screen ${this.screen!.height} px`);
});

Then('列表的滚动位置没有变', async function (this: QuiescoWorld) {
  await this.app.expectVisible({ text: '待办 1' });
});

When('截取完整的 {string}，命名为 {string}', async function (this: ShotWorld, id: string, name: string) {
  this.shot = await this.app.device.screenshot(id, { full: true, name });
});

Then('截图比屏幕上能看到的 {string} 更长', async function (this: ShotWorld, id: string) {
  const visible = await this.app.device.screenshot(id);
  assert.ok(pngSize(this.shot!).height > pngSize(visible).height * 1.5, `full ${pngSize(this.shot!).height} px, visible ${pngSize(visible).height} px`);
});
