// ESM environment: can it import ESM-only packages and still share state across files?
import fs from 'node:fs';
import { TestEnvironment } from 'jest-environment-node';
import { marker } from './esm-dep.mjs';
const log = (m) => fs.appendFileSync(process.env.SPIKE_LOG, `${m}\n`);
let session = null;
export default class QuiescoEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    log(`maxWorkers=${config.globalConfig.maxWorkers} testTimeout=${config.projectConfig.testTimeout ?? config.globalConfig.testTimeout}`);
  }
  async setup() {
    await super.setup();
    session ??= { id: `${process.pid}-${marker}` };
    this.global.quiesco = session;
  }
  async handleTestEvent(event) {
    if (event.name === 'test_start' && event.test.name.includes('@android')) event.test.mode = 'skip';
    if (event.name === 'test_done' && event.test.errors.length > 0) {
      const e = event.test.errors[0]; const err = Array.isArray(e) ? e[0] : e;
      if (err && typeof err === 'object') { err.message += '\n\nQuiesco evidence: artifacts/x'; if (typeof err.stack === 'string') err.stack = err.stack.replace(/\n/, '\n\nQuiesco evidence: artifacts/x\n'); }
    }
  }
}
