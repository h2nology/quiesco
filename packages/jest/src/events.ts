/**
 * The Jest side of the lifecycle (Phase 6.10, findings 6.10 batch B), on jest-circus events — structural
 * types only, so it can be unit-tested without Jest:
 *
 * - `test_start` (dispatched before Jest decides to skip): a test tagged for another platform gets
 *   `mode = 'skip'`.
 * - `test_started` (before the beforeEach hooks): reset the app.
 * - `test_done` (after the afterEach hooks): end the test; on failure the evidence files are added to the
 *   first error's message. An app error reported after a passed test fails it.
 */
import { titleTags } from '@quiesco/core';
import type { Lifecycle } from '@quiesco/core';

export interface BlockLike {
  name: string;
  parent?: BlockLike | undefined;
}

export interface TestLike extends BlockLike {
  mode?: string | undefined;
  errors: unknown[];
}

export interface EventLike {
  name: string;
  test?: TestLike;
}

const ROOT = 'ROOT_DESCRIBE_BLOCK';

function chain(test: TestLike): BlockLike[] {
  const out: BlockLike[] = [];
  for (let n: BlockLike | undefined = test; n !== undefined; n = n.parent) if (n.name !== ROOT) out.unshift(n);
  return out;
}

/** Title tags by level, outermost describe first. */
export function tagLevelsOf(test: TestLike): string[][] {
  return chain(test).map((n) => titleTags(n.name));
}

/** "describe > test": the name of the test's artifacts directory. */
export function fullName(test: TestLike): string {
  return chain(test)
    .map((n) => n.name)
    .join(' > ');
}

/** Adds where the evidence is to a failed test's first error (Jest prints the message from `stack`). */
export function addEvidence(test: TestLike, files: readonly string[]): void {
  const first = test.errors[0];
  const err = (Array.isArray(first) ? first[0] : first) as { message?: unknown; stack?: unknown } | undefined;
  if (err === undefined || err === null || typeof err !== 'object' || files.length === 0) return;
  const note = `\n\nQuiesco evidence:\n${files.map((f) => `  ${f}`).join('\n')}`;
  if (typeof err.message === 'string') err.message += note;
  if (typeof err.stack === 'string') err.stack = err.stack.replace(/\n|$/, `${note}\n`);
}

export async function handleEvent(lifecycle: Lifecycle, event: EventLike): Promise<void> {
  const test = event.test;
  if (test === undefined || !lifecycle.running) return;
  if (event.name === 'test_start') {
    if (!lifecycle.runsHere(tagLevelsOf(test))) test.mode = 'skip';
  } else if (event.name === 'test_started') {
    try {
      await lifecycle.before(tagLevelsOf(test), fullName(test));
    } catch (e) {
      test.errors.push(e);
    }
  } else if (event.name === 'test_done') {
    const failed = test.errors.length > 0;
    try {
      const { files } = await lifecycle.after({ tags: tagLevelsOf(test).flat(), failed });
      if (failed) addEvidence(test, files);
    } catch (e) {
      test.errors.push(e);
    }
  }
}

/** Jest runs test files in worker processes when maxWorkers > 1: each would start a session on the same device. */
export function jestParallel(maxWorkers: number | undefined): string | null {
  return maxWorkers !== undefined && maxWorkers > 1
    ? `Quiesco needs Jest to run test files one at a time (maxWorkers is ${maxWorkers}): every worker would drive the same device. Set maxWorkers: 1 in the Jest config (or run with --runInBand).`
    : null;
}
