// Support code for the integration test: a fake session instead of a device.
import { Given, Then, When } from '@cucumber/cucumber';
import { registerQuiesco } from '@quiesco/cucumber';

export const log = [];
globalThis.__quiescoTestLog = log;

const driver = {
  async tap(id) {
    log.push(`tap ${id}`);
    if (id === 'broken') throw new Error('No element matches { id: "broken" }');
  },
  takeAppError: () => null,
};

registerQuiesco({
  config: { apps: { android: { package: 'p' } } },
  platform: 'android',
  createSession: async () => ({
    driver,
    beforeScenario: async ({ tags }) => log.push(`reset ${tags.includes('@hard-reset') ? 'hard' : 'soft'}`),
    collectEvidence: async () => ({ screenshot: Buffer.from('PNG'), tree: { type: 'RCTView', children: [] }, errors: [] }),
    dispose: async () => log.push('dispose'),
  }),
});

When('I tap {string}', async function (id) {
  await this.app.tap(id);
});
Given('nothing', () => {});
Then('the app saw {string}', function (entry) {
  if (!log.includes(entry)) throw new Error(`missing ${entry}`);
});
