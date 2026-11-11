/**
 * @quiesco/jest (Phase 6.10): Quiesco for Jest.
 *
 *   // jest.config.js
 *   module.exports = { preset: '@quiesco/jest', maxWorkers: 1, testTimeout: 60_000 };
 *
 *   // e2e/todo.test.js — `quiesco` is a global, like Jest's own `test` / `expect`
 *   test('a new todo appears at the top @ios', async () => {
 *     await quiesco.app.tap('add-todo');
 *   });
 *
 * One session (device + app) for the whole run, a reset before every test, a test tagged for another
 * platform (in its or a describe's title; the innermost wins) is skipped, and a failure's message names
 * the evidence files. TypeScript: add `"types": ["@quiesco/jest"]` for the `quiesco` global.
 */
import type { Driver, Session } from '@quiesco/core';

export interface QuiescoGlobal {
  readonly app: Driver;
  readonly session: Session;
}

declare global {
  var quiesco: QuiescoGlobal;
}

export { addEvidence, fullName, handleEvent, jestParallel, tagLevelsOf } from './events.js';
export type { BlockLike, EventLike, TestLike } from './events.js';
