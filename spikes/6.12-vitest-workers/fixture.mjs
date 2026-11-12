import { test as base } from 'vitest';
import fs from 'node:fs';
const log = (m) => fs.appendFileSync(new URL('./events.log', import.meta.url), `${process.pid} pool=${process.env.VITEST_POOL_ID} worker=${process.env.VITEST_WORKER_ID} ${m}\n`);
export const test = base.extend({
  session: [async ({}, use) => { log('session setup'); await use('s'); log('teardown start'); await new Promise(r => setTimeout(r, 3000)); log('teardown done (3s async)'); }, { scope: 'worker' }],
});
