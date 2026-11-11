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
 * - One session (device + app) for the whole run, as a worker fixture: with `quiesco()` from
 *   `@quiesco/vitest/config` every file runs in one worker. Closed when the run ends.
 * - Before each test that uses `app` (or `session`): skipped when tagged for another platform (in its
 *   title or `{ tags }`, the innermost level decides), else the app is reset.
 * - After a failed test: the evidence (screenshot, element tree, idle state, logs) is written to the
 *   artifacts directory and its path is added to the failure message.
 */
import { Lifecycle } from '@quiesco/core';
import type { Driver, Session } from '@quiesco/core';
import { test as base } from 'vitest';

import { fullName, tagLevelsOf } from './tags.js';
import type { TaskLike } from './tags.js';

export { quiesco } from './config.js';
export type { QuiescoVitestOptions } from './config.js';
export { fullName, tagLevelsOf } from './tags.js';
export type { TaskLike } from './tags.js';

/** Vitest runs test files in parallel workers: each would start its own session on the same device. */
export function vitestParallel(): string | null {
  // Internal, best effort: the worker's resolved config (absent → no check).
  const config = (globalThis as { __vitest_worker__?: { config?: { maxWorkers?: number } } }).__vitest_worker__?.config;
  return config?.maxWorkers !== undefined && config.maxWorkers > 1
    ? `Quiesco needs Vitest to run test files one at a time (maxWorkers is ${config.maxWorkers}): every worker would drive the same device. Use quiesco() from '@quiesco/vitest/config' (fileParallelism: false).`
    : null;
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
      const lifecycle = new Lifecycle({ checkSerial: vitestParallel });
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
