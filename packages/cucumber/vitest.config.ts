import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'cucumber', include: ['test/**/*.test.ts'], typecheck: { enabled: true, tsconfig: './tsconfig.test.json', include: ['test/**/*.test-d.ts'] } },
});
