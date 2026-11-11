// Steps of features/showcase.feature (Phase 6.11: the capability index and the reorderable list).
import { Given, Then, When } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';

Given('打开能力一览', async function (this: QuiescoWorld) {
  await this.app.backdoor('openShowcase');
  await this.app.expectVisible('showcase');
});

When('在能力一览点 {string}', async function (this: QuiescoWorld, entry: string) {
  await this.app.tap(`showcase-${entry}`);
});

Then('看到页面 {string}', async function (this: QuiescoWorld, root: string) {
  await this.app.expectVisible(root);
});

Given('打开拖拽排序页', async function (this: QuiescoWorld) {
  await this.app.backdoor('openShowcase');
  await this.app.tap('showcase-reorder');
  await this.app.expectVisible('reorder');
});

// The rows' testIDs follow their starting position, so they stay the same after a move. `drag` holds the
// row (800 ms by default) before it moves, which is what picks it up.
When('把第 {int} 行拖到第 {int} 行的位置', async function (this: QuiescoWorld, from: number, to: number) {
  await this.app.drag(`reorder-item-${from}`, `reorder-item-${to}`);
});

When('在第 {int} 行上快速向下滑动', async function (this: QuiescoWorld, row: number) {
  await this.app.swipe(`reorder-item-${row}`, 'down', { distance: 120 });
});

Then('列表顺序是 {string}', async function (this: QuiescoWorld, order: string) {
  await this.app.expectText('reorder-result', order);
});
