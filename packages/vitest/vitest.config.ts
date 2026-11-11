import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'vitest-adapter', include: ['test/**/*.test.ts'] },
});
