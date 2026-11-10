// What covers the app after a scenario enrolled Face ID and the next scenario's reset undid it (iOS)?
import { startMockServer } from '../../examples/todo-app/mock-server/server.mjs';
import { log, open, shot } from './common.mts';
const mock = await startMockServer();
const s = await open('ios');
try {
  await s.device.biometrics.enroll();
  await s.beforeScenario({});
  await s.driver.backdoor('openSystem');
  await shot(s, 'ios-after-reset');
  try {
    await s.driver.tap('read-enrollment');
    log('tap ok');
  } catch (e) {
    log('tap failed', (e as Error).message.slice(0, 120));
  }
} finally {
  await s.dispose();
  await mock.close();
}
