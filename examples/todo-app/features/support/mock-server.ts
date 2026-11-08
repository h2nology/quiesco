// Starts the local mock backend for the whole run (MOCK_DELAY_MS slows every response down).
// With `--parallel N` every worker gets its own backend on 3001 + worker index, so their data never
// mixes; the app picks the port from quiesco.workerIndex() (src/e2e.ts).
import { AfterAll, BeforeAll } from '@cucumber/cucumber';

import { startMockServer } from '../../mock-server/server.mjs';

let server: { close(): Promise<unknown> } | null = null;

BeforeAll(async function () {
  server = await startMockServer({ port: 3001 + (Number(process.env['CUCUMBER_WORKER_ID'] ?? 0) || 0) });
});

AfterAll(async function () {
  await server?.close();
});
