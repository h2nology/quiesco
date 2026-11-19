// A project for the list test (#55): hook calls through `test.` are not tests.
import os from 'node:os';
import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: path.join(os.tmpdir(), 'quiesco-vitest-list-hooks-fixture'),
  test: { include: ['tests/**/*.e2e.{mjs,ts}'] },
});
