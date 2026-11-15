/**
 * `test` options for Vitest (Phase 6.10):
 *
 *   // vitest.config.ts
 *   import { defineConfig } from 'vitest/config';
 *   import { quiesco } from '@quiesco/vitest/config';
 *   export default defineConfig({ test: { ...quiesco(), include: ['e2e/**\/*.test.ts'] } });
 *
 * - `isolate: false`: a worker keeps its session (the device and the app) across test files (findings
 *   6.10 batch B). `workers` (default 1) worker processes run files in parallel, each on its own device
 *   (Phase 6.12): `quiesco({ workers: 2 })`, or `--fileParallelism --maxWorkers 2` on the command line.
 * - The platform tags are declared, so `test(name, { tags: ['@ios'] }, …)` is accepted.
 * - `testTimeout`: the first test also waits for the session (booting a device can take minutes).
 * - `quiescoPlugin()` (in `plugins`) sends the run's progress to `quiesco test` / `quiesco ui`.
 */
import { fileURLToPath } from 'node:url';

import { DEFAULT_TAGS, RUN_EVENTS_ENV } from '@quiesco/core';
import type { TagNames } from '@quiesco/core';

export interface QuiescoVitestOptions {
  /** Tag names when quiesco.config renames them (`tags` there). */
  tags?: Partial<TagNames>;
  /** Default 300 s (the first test includes starting the session). */
  testTimeout?: number;
  /** Extra tags of your own to declare, e.g. `['@smoke']`. */
  extraTags?: readonly string[];
  /** Parallel workers, each with its own device (Phase 6.12). Default 1 (serial). */
  workers?: number;
}

export function quiesco(options: QuiescoVitestOptions = {}) {
  const names = { ...DEFAULT_TAGS, ...options.tags };
  const declared = [...new Set([names.ios, names.android, names.web, names.native, names.hardReset, ...(options.extraTags ?? [])])];
  return {
    pool: 'forks' as const,
    isolate: false,
    // Serial unless asked for; `vitest --fileParallelism --maxWorkers N` overrides both.
    fileParallelism: (options.workers ?? 1) > 1,
    maxWorkers: Math.max(1, options.workers ?? 1),
    testTimeout: options.testTimeout ?? 300_000,
    hookTimeout: options.testTimeout ?? 300_000,
    teardownTimeout: 120_000,
    tags: declared.map((name) => ({ name })),
    // Lines for the run events (progress bar, `quiesco ui`: run one test by file:line).
    includeTaskLocation: true,
  };
}

/** The parts of Vitest's `configureVitest` context used here (structural: no vitest import). */
interface ConfigureVitestContext {
  vitest: { config: { reporters: unknown[] } };
}

/**
 * Vite plugin that adds Quiesco's reporter when `quiesco test` / `quiesco ui` runs Vitest (it sets
 * QUIESCO_EVENTS), keeping the reporters you configured or passed with `--reporter`:
 *
 *   export default defineConfig({ plugins: [quiescoPlugin()], test: { ...quiesco() } });
 */
export function quiescoPlugin() {
  return {
    name: 'quiesco:run-events',
    configureVitest({ vitest }: ConfigureVitestContext): void {
      const address = process.env[RUN_EVENTS_ENV];
      if (address === undefined || address === '') return;
      vitest.config.reporters.push([fileURLToPath(new URL('./reporter.js', import.meta.url)), {}]);
    },
  };
}
