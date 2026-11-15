// A user project for the run-events test: its own reporter ('dot') must survive quiescoPlugin().
import os from 'node:os';
import path from 'node:path';

import { quiescoPlugin } from '@quiesco/vitest/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [quiescoPlugin()],
  cacheDir: path.join(os.tmpdir(), 'quiesco-vitest-events-fixture'),
  test: { include: ['tests/**/*.e2e.mjs'], reporters: ['dot'], includeTaskLocation: true, maxWorkers: 1, fileParallelism: false },
});
