import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'protocol', include: ['test/**/*.test.ts'], typecheck: { enabled: true, include: ['test/**/*.test.ts'] } },
});
