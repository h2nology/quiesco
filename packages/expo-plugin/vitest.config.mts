import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'expo-plugin', include: ['test/**/*.test.ts'] },
});
