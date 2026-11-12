// Starts the local mock backend for the whole run (MOCK_DELAY_MS slows every response down). With
// `--parallel N` every worker thread gets its own backend on MOCK_PORT + worker index (Phase 6.12), so
// their data never mixes; the app picks the same port (src/e2e.ts).
import { AfterAll, BeforeAll } from '@cucumber/cucumber';

import { startMockServer } from '../../mock-server/server.mjs';

let server: { close(): Promise<unknown> } | null = null;

BeforeAll(async function () {
  const worker = Number(process.env['CUCUMBER_WORKER_ID'] ?? 0) || 0;
  server = await startMockServer({ port: Number(process.env['MOCK_PORT'] ?? 3001) + worker });
});

AfterAll(async function () {
  await server?.close();
});
