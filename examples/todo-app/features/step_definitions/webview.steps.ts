// Steps of features/webview.feature (Phase 6.8: app.webview()).
import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';

const help = (w: QuiescoWorld) => w.app.webview('help');

Given('打开帮助页', async function (this: QuiescoWorld) {
  await this.app.backdoor('openWebView');
  await this.app.expectVisible('webview-page');
});

When('在网页的名字输入框里输入 {string}', async function (this: QuiescoWorld, text: string) {
  await help(this).element({ css: '#name' }).type(text);
});

When('把网页的名字输入框改成 {string}', async function (this: QuiescoWorld, text: string) {
  await help(this).element({ xpath: '//input[@name="name"]' }).replaceText(text);
});

When('点击网页上的 {string}', async function (this: QuiescoWorld, text: string) {
  await help(this).element({ text }).tap();
});

Then('网页上的问候是 {string}', async function (this: QuiescoWorld, text: string) {
  await help(this).element({ id: 'result' }).expectText(text);
});

Then('网页上的稍后问候是 {string}', async function (this: QuiescoWorld, text: string) {
  await help(this).element({ id: 'slow-result' }).expectText(text);
});

Then('网页上的 {string} 不在可见区域', async function (this: QuiescoWorld, text: string) {
  await help(this).element({ text }).expectNotVisible();
});

When('把网页滚动到 {string}', async function (this: QuiescoWorld, text: string) {
  await help(this).element({ text }).scrollIntoView();
});

Then('网页上的 {string} 可见', async function (this: QuiescoWorld, text: string) {
  await help(this).element({ text }).expectVisible();
});

Then('网页的地址以 {string} 结尾', async function (this: QuiescoWorld, suffix: string) {
  const url = await help(this).url();
  assert.ok(url.endsWith(suffix), `url ${url} does not end with ${suffix}`);
});

Then('网页的标题是 {string}', async function (this: QuiescoWorld, title: string) {
  assert.equal(await help(this).title(), title);
});

Then('网页脚本读到的标题是 {string}', async function (this: QuiescoWorld, title: string) {
  assert.equal(await help(this).runScript<string>('return document.title'), title);
});
