// Starts the mock backends for the whole run: one per Jest worker (Phase 6.12), on MOCK_PORT + worker
// index, as the app expects (src/e2e.ts). Globals set here are visible to globalTeardown.
import { startMockServer } from '../../mock-server/server.mjs';

export default async function setup(globalConfig) {
  const base = Number(process.env.MOCK_PORT ?? 3001);
  const workers = Math.max(1, globalConfig.maxWorkers ?? 1);
  globalThis.__mockServers = await Promise.all(Array.from({ length: workers }, (_, i) => startMockServer({ port: base + i })));
}
