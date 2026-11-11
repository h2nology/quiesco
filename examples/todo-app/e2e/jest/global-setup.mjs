// Starts the mock backend for the whole run. Globals set here are visible to globalTeardown.
import { startMockServer } from '../../mock-server/server.mjs';

export default async function setup() {
  globalThis.__mockServer = await startMockServer();
}
