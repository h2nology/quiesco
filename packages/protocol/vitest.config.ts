import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'protocol', include: ['test/**/*.test.ts'], typecheck: { enabled: true, tsconfig: './tsconfig.test.json', include: ['test/**/*.test.ts'] } },
});
