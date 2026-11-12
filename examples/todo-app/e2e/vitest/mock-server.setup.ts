// Starts the mock backends for the whole run (in Vitest's main process): one per worker (Phase 6.12), on
// MOCK_PORT + worker index, as the app expects (src/e2e.ts); closed at the end.
import { startMockServer } from '../../mock-server/server.mjs';

interface ProjectLike {
  config: { maxWorkers?: number; fileParallelism?: boolean };
}

export default async function setup(project: ProjectLike): Promise<() => Promise<void>> {
  const base = Number(process.env['MOCK_PORT'] ?? 3001);
  const workers = project.config.fileParallelism === false ? 1 : Math.max(1, project.config.maxWorkers ?? 1);
  const servers = await Promise.all(Array.from({ length: workers }, (_, i) => startMockServer({ port: base + i })));
  return async () => {
    await Promise.all(servers.map((s) => s.close()));
  };
}
