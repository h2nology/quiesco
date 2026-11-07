import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'agent', include: ['test/**/*.test.ts'] },
});
