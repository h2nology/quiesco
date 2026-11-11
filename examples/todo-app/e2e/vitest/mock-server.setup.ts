// Starts the mock backend for the whole run (in Vitest's main process) and closes it at the end.
import { startMockServer } from '../../mock-server/server.mjs';

export default async function setup(): Promise<() => Promise<void>> {
  const server = await startMockServer();
  return async () => {
    await server.close();
  };
}
