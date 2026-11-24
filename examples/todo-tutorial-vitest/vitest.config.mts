// Quiesco's e2e tests. quiesco(): one app session per worker, kept across files, one file at a time.
// quiescoPlugin(): the run's progress for `quiesco test` and `quiesco ui`.
import { quiesco, quiescoPlugin } from '@quiesco/vitest/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [quiescoPlugin()],
  test: {
    ...quiesco(),
    include: ['e2e/**/*.test.ts'],
  },
});
