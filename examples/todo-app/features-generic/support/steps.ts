// World, hooks and every generic step (all three languages). Only opening a hidden page needs a step of
// the app's own: the generic steps script taps and texts, they know nothing about backdoors.
import { Given } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';
import '@quiesco/cucumber/register';
import { registerQuiescoSteps } from '@quiesco/steps';

registerQuiescoSteps();

Given('通过后门 {string} 打开页面 {string}', async function (this: QuiescoWorld, backdoor: string, page: string) {
  await this.app.backdoor(backdoor);
  await this.app.expectVisible(page);
});
