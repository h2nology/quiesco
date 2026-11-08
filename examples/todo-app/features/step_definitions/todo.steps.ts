// Step definitions call only the Quiesco driver: no waits, no sleeps (requirements.md §9, §12).
import { Given, Then, When } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';

Given('用户 {string} 已登录', async function (this: QuiescoWorld, email: string) {
  await this.app.backdoor('loginAs', email);
});

Given('待办列表为空', async function (this: QuiescoWorld) {
  await this.app.backdoor('seedTodos', []);
});

Given('待办列表中有 {string} 和 {string}', async function (this: QuiescoWorld, first: string, second: string) {
  await this.app.backdoor('seedTodos', [first, second]);
});

When('新建一条标题为 {string} 的待办', async function (this: QuiescoWorld, title: string) {
  await this.app.tap({ id: 'add-todo' });
  await this.app.type({ id: 'todo-title' }, title);
  await this.app.tap({ role: 'button', text: '保存' });
});

When('尝试新建一条标题为空的待办', async function (this: QuiescoWorld) {
  await this.app.tap({ id: 'add-todo' });
  await this.app.tap({ role: 'button', text: '保存' });
});

When('用户以 {string} 登录', async function (this: QuiescoWorld, email: string) {
  await this.app.type({ id: 'email' }, email);
  await this.app.type({ id: 'password' }, 'secret');
  await this.app.tap({ id: 'login-button' });
});

When('用户不输入邮箱直接登录', async function (this: QuiescoWorld) {
  await this.app.tap({ id: 'login-button' });
});

Then('列表第一条是 {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.expectText({ id: 'todo-item', index: 0 }, title);
});

Then('看到提示 {string}', async function (this: QuiescoWorld, message: string) {
  await this.app.expectVisible({ text: message });
});

Then('待办列表仍然为空', async function (this: QuiescoWorld) {
  await this.app.expectCount({ id: 'todo-item' }, 0);
});

Then('看到 {string} 的待办列表', async function (this: QuiescoWorld, email: string) {
  await this.app.expectText({ id: 'greeting' }, email);
  await this.app.expectVisible({ id: 'todo-list' });
});

When('清空全部待办并确认', async function (this: QuiescoWorld) {
  await this.app.tap({ id: 'clear-todos' });
  await this.app.tap({ id: 'confirm-clear' });
});

When('清空全部待办但取消', async function (this: QuiescoWorld) {
  await this.app.tap({ id: 'clear-todos' });
  await this.app.tap({ id: 'cancel-clear' });
});

Then('列表中有 {int} 条待办', async function (this: QuiescoWorld, count: number) {
  await this.app.expectCount({ id: 'todo-item' }, count);
});

Then('App 可以直接使用位置信息', async function (this: QuiescoWorld) {
  const state = await this.app.backdoor('locationPermission');
  if (state !== 'granted') throw new Error(`location permission is ${JSON.stringify(state)}, expected "granted"`);
});
