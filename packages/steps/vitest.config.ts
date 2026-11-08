import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'steps', include: ['test/**/*.test.ts'] },
});
