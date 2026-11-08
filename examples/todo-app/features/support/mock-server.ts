// Starts the local mock backend for the whole run (MOCK_DELAY_MS slows every response down).
import { AfterAll, BeforeAll } from '@cucumber/cucumber';

import { startMockServer } from '../../mock-server/server.mjs';

let server: { close(): Promise<unknown> } | null = null;

BeforeAll(async function () {
  server = await startMockServer();
});

AfterAll(async function () {
  await server?.close();
});
