// The environment module lives in the outer realm: its module state survives across test files run in
// the same process (--runInBand). Each test file gets `globalThis.__session` from it.
const fs = require('node:fs');
const { TestEnvironment } = require('jest-environment-node');
const log = (m) => fs.appendFileSync(process.env.SPIKE_LOG, `${m}\n`);
let session = null;
let files = 0;
class QuiescoEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();
    if (session === null) {
      session = { id: `${process.pid}-${Date.now()}` };
      log(`env create ${session.id}`);
    }
    files++;
    this.global.__session = session;
  }
  async handleTestEvent(event) {
    if (event.name === 'test_done') log(`event test_done ${event.test.name} errors=${event.test.errors.length}`);
  }
  async teardown() {
    files--;
    log(`env teardown (files left ${files})`);
    await super.teardown();
  }
}
module.exports = QuiescoEnvironment;
module.exports.dispose = async () => log(`dispose ${session && session.id}`);
