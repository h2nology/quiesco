// The example's Vitest e2e tests (Phase 6.10): `pnpm test:vitest` with QUIESCO_PLATFORM=ios|android|web.
// quiesco(): every file in one worker, so the app is started once for the run; the platform tags declared.
import { quiesco } from '@quiesco/vitest/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    ...quiesco(),
    include: ['e2e/vitest/**/*.test.ts'],
    // The mock backend the app talks to (MOCK_PORT, like the cucumber run).
    globalSetup: ['e2e/vitest/mock-server.setup.ts'],
  },
});
