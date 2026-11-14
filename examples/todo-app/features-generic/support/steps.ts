// World, hooks and every generic step (all three languages). Only opening a hidden page needs a step of
// the app's own: the generic steps script taps and texts, they know nothing about backdoors.
import { Given } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';
import type { Backdoors } from '@quiesco/core';
import '@quiesco/cucumber/register';
import { registerQuiescoSteps } from '@quiesco/steps';

registerQuiescoSteps();

Given('通过后门 {string} 打开页面 {string}', async function (this: QuiescoWorld, backdoor: string, page: string) {
  // The name comes from the feature text: src/backdoors.ts declares the backdoors, so say it is one of them.
  await this.app.backdoor(backdoor as keyof Backdoors);
  await this.app.expectVisible(page);
});
