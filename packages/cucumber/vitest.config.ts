import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'cucumber', include: ['test/**/*.test.ts'] },
});
