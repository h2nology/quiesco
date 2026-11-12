// The example's Vitest e2e tests (Phase 6.10): `pnpm test:vitest` with QUIESCO_PLATFORM=ios|android|web.
// quiesco(): a worker keeps its app across files; the platform tags declared.
import { quiesco } from '@quiesco/vitest/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // QUIESCO_WORKERS=N (or `--fileParallelism --maxWorkers N`) runs the files on N devices in parallel.
    ...quiesco({ workers: Number(process.env['QUIESCO_WORKERS'] ?? 1) }),
    include: ['e2e/vitest/**/*.test.ts'],
    // The mock backends the app talks to (MOCK_PORT + worker index, like the cucumber run).
    globalSetup: ['e2e/vitest/mock-server.setup.ts'],
  },
});
