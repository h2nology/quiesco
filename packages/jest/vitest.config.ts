import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'jest-adapter', include: ['test/**/*.test.ts'] },
});
