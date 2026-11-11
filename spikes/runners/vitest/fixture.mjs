import fs from 'node:fs';
import { test as base } from 'vitest';
const log = (m) => fs.appendFileSync(process.env.SPIKE_LOG, `${m}\n`);
export const test = base.extend({
  session: [
    async ({}, use) => {
      const s = { id: `${process.pid}-${Date.now()}` };
      log(`fixture setup ${s.id}`);
      await use(s);
      await new Promise((r) => setTimeout(r, 200)); // async teardown (like dispose)
      log(`fixture teardown ${s.id}`);
    },
    { scope: 'worker' },
  ],
});
