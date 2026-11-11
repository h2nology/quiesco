import fs from 'node:fs';
import { test } from 'vitest';
test('cfg', () => {
  const w = globalThis.__vitest_worker__;
  const c = w?.config ?? {};
  fs.appendFileSync(process.env.SPIKE_LOG, JSON.stringify({ keys: Object.keys(w ?? {}).slice(0, 30), isolate: c.isolate, fileParallelism: c.fileParallelism, maxWorkers: c.maxWorkers, pool: c.pool, poolOptions: c.poolOptions, env: { pool: process.env.VITEST_POOL_ID, worker: process.env.VITEST_WORKER_ID } }) + '\n');
});
