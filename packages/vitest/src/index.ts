/**
 * @quiesco/vitest (Phase 6.10): Quiesco for Vitest.
 *
 *   import { test } from '@quiesco/vitest';
 *
 *   test('a new todo appears at the top @ios', async ({ app }) => {
 *     await app.tap('add-todo');
 *   });
 *   test('Android only', { tags: ['@android'] }, async ({ app }) => { … });
 *
 * - One session (device + app) per worker, as a worker fixture: with `quiesco()` from
 *   `@quiesco/vitest/config` every file runs in one worker; `quiesco({ workers: N })` runs files on N
 *   devices in parallel (Phase 6.12). Closed when the worker ends.
 * - Before each test that uses `app` (or `session`): skipped when tagged for another platform (in its
 *   title or `{ tags }`, the innermost level decides), else the app is reset.
 * - After a failed test: the evidence (screenshot, element tree, idle state, logs) is written to the
 *   artifacts directory and its path is added to the failure message.
 */
import { Lifecycle } from '@quiesco/core';
import type { Driver, Session, WorkerInfo } from '@quiesco/core';
import { test as base } from 'vitest';

import { fullName, tagLevelsOf } from './tags.js';
import type { TaskLike } from './tags.js';

export { quiesco } from './config.js';
export type { QuiescoVitestOptions } from './config.js';
export { fullName, tagLevelsOf } from './tags.js';
export type { TaskLike } from './tags.js';

/**
 * The worker this process is (Phase 6.12): VITEST_POOL_ID (1…maxWorkers) is fixed for a worker process,
 * unlike VITEST_WORKER_ID, which changes with every file (findings 6.12). The count comes from the
 * worker's resolved config (internal, best effort): one worker when files do not run in parallel.
 */
export function vitestWorker(
  env: NodeJS.ProcessEnv = process.env,
  config: { maxWorkers?: number; fileParallelism?: boolean } | undefined = (globalThis as { __vitest_worker__?: { config?: { maxWorkers?: number; fileParallelism?: boolean } } }).__vitest_worker__?.config,
): WorkerInfo {
  const count = config?.fileParallelism === false || config?.maxWorkers === undefined ? 1 : Math.max(1, config.maxWorkers);
  const id = Number.parseInt(env['VITEST_POOL_ID'] ?? '', 10);
  if (count === 1 || !(id >= 1)) return { index: 0, count };
  return { index: Math.min(id, count) - 1, count };
}

interface FailedTask extends TaskLike {
  result?: { state?: string; errors?: { message?: string; stack?: string }[] } | undefined;
}

/** Adds where the evidence is to the first error of a failed test (Vitest has no attachments after a test ends). */
export function addEvidence(task: FailedTask, files: readonly string[]): void {
  const err = task.result?.errors?.[0];
  if (err === undefined || files.length === 0) return;
  const note = `\n\nQuiesco evidence:\n${files.map((f) => `  ${f}`).join('\n')}`;
  err.message = `${err.message ?? ''}${note}`;
  if (typeof err.stack === 'string') err.stack = err.stack.replace(/\n|$/, `${note}\n`);
}

/** A session that failed to start fails the remaining tests at once instead of starting again for each. */
let startFailure: unknown = null;

export const test = base.extend<{
  $worker: { quiesco: Lifecycle };
  $test: { app: Driver; session: Session };
}>({
  quiesco: [
    // Vitest reads a fixture's dependencies from the destructuring pattern: it must be `{}` here.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      if (startFailure !== null) throw startFailure;
      const lifecycle = new Lifecycle({ worker: vitestWorker() });
      try {
        await lifecycle.beforeAll();
      } catch (e) {
        startFailure = e;
        throw e;
      }
      try {
        await use(lifecycle);
      } finally {
        await lifecycle.afterAll();
      }
    },
    { scope: 'worker' },
  ],
  session: async ({ quiesco, task, skip }, use) => {
    const t = task as unknown as FailedTask;
    if ((await quiesco.before(tagLevelsOf(t), fullName(t))) === 'skipped') skip('tagged for another platform');
    try {
      await use(quiesco.current);
    } finally {
      const failed = t.result?.state === 'fail';
      const { files } = await quiesco.after({ tags: tagLevelsOf(t).flat(), failed });
      if (failed) addEvidence(t, files);
    }
  },
  app: async ({ session }, use) => {
    await use(session.driver);
  },
});

export const it = test;
export { describe, expect } from 'vitest';
