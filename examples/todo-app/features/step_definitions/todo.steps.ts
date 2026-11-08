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

// ---- form state (Phase 6.1: focus, enabled, checked, value, semantic type) ----

When('打开新建待办页面', async function (this: QuiescoWorld) {
  await this.app.tap({ id: 'add-todo' });
});

When('输入标题 {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.type({ id: 'todo-title' }, title);
});

When('标记为重要', async function (this: QuiescoWorld) {
  await this.app.tap({ type: 'switch', label: '标记为重要' });
});

Then('标题输入框获得焦点', async function (this: QuiescoWorld) {
  await this.app.expectFocused({ id: 'todo-title' });
});

Then('还不能标记为重要', async function (this: QuiescoWorld) {
  await this.app.expect({ id: 'todo-important' }).toBeDisabled();
});

Then('页面上有 {int} 个开关，并且是关闭的', async function (this: QuiescoWorld, count: number) {
  await this.app.expectCount({ type: 'switch', within: 'new-todo-screen' }, count);
  await this.app.expect({ type: 'switch', within: 'new-todo-screen' }).not.toBeChecked();
});

Then('标题输入框的内容是 {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.expectValue({ id: 'todo-title' }, title);
});

Then('已标记为重要', async function (this: QuiescoWorld) {
  await this.app.expect({ id: 'todo-important' }).toBeEnabled();
  await this.app.expectChecked({ id: 'todo-important' });
});

When('在标题框按回车', async function (this: QuiescoWorld) {
  await this.app.pressKey({ id: 'todo-title' }, 'enter');
});

// ---- playground (Phase 6.2 actions) ----

const CANVAS_POINTS: Record<string, { x: number; y: number }> = {
  // The canvas is 200 × 100; points are in its own coordinates.
  左上角: { x: 10, y: 10 },
  右上角: { x: 190, y: 10 },
  左下角: { x: 10, y: 90 },
  右下角: { x: 190, y: 90 },
};

Given('打开能力演示页', async function (this: QuiescoWorld) {
  await this.app.backdoor('openPlayground');
  await this.app.expectVisible({ id: 'playground' });
});

When('点击画布的 {string}', async function (this: QuiescoWorld, corner: string) {
  const point = CANVAS_POINTS[corner];
  if (point === undefined) throw new Error(`unknown corner ${corner}`);
  await this.app.tap({ id: 'canvas' }, { point });
});

Then('点中了 {string}', async function (this: QuiescoWorld, quadrant: string) {
  await this.app.expectText({ id: 'tap-result' }, quadrant);
});

When('连续点击计数按钮 {int} 次', async function (this: QuiescoWorld, n: number) {
  await this.app.multiTap({ id: 'counter' }, n);
});

When('按屏幕坐标点击计数按钮所在的位置', async function (this: QuiescoWorld) {
  const { rect } = await this.app.attributes({ id: 'counter' });
  if (rect === null) throw new Error('counter has no rect');
  await this.app.tapAt({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
});

Then('计数是 {string}', async function (this: QuiescoWorld, count: string) {
  await this.app.expectText({ id: 'count' }, count);
});

When('在备注框输入 {string}', async function (this: QuiescoWorld, text: string) {
  await this.app.type({ id: 'note' }, text);
});

When('在备注框按 {string}', async function (this: QuiescoWorld, key: string) {
  await this.app.pressKey({ id: 'note' }, key as 'enter' | 'backspace');
});

When('把备注替换为 {string}', async function (this: QuiescoWorld, text: string) {
  await this.app.replaceText({ id: 'note' }, text);
});

Then('备注框的内容是 {string}', async function (this: QuiescoWorld, text: string) {
  await this.app.expectValue({ id: 'note' }, text);
});

Then('已提交 {string}', async function (this: QuiescoWorld, text: string) {
  await this.app.expectText({ id: 'submitted' }, text);
});

When('把方块拖到 {string}', async function (this: QuiescoWorld, zone: string) {
  await this.app.drag({ id: 'drag-box' }, { id: zone });
});

Then('看到拖拽结果 {string}', async function (this: QuiescoWorld, result: string) {
  await this.app.expectText({ id: 'drop-result' }, result);
});

When('把长列表滚动到第 {int} 行', async function (this: QuiescoWorld, row: number) {
  await this.app.scrollToIndex({ id: 'long-list' }, row - 1);
});

When('把长列表滚动到 {string}', async function (this: QuiescoWorld, edge: string) {
  await this.app.scrollToEdge({ id: 'long-list' }, edge as 'top' | 'bottom');
});

Then('第 {int} 行可见', async function (this: QuiescoWorld, row: number) {
  await this.app.expectVisible({ id: `row-${row}` });
});
