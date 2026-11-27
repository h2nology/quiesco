import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'core', include: ['test/**/*.test.ts'], setupFiles: ['test/setup-home.ts'], typecheck: { enabled: true, tsconfig: './tsconfig.test.json', include: ['test/**/*.test-d.ts'] } },
});
