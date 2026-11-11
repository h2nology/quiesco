/**
 * Tags of a Vitest test grouped by level, outermost suite first (Phase 6.10): each level is the tags in
 * that suite's or test's title plus its own `{ tags }` (Vitest reports inherited tags merged, so a
 * level's own tags are its tags minus its parent's). The innermost level with a platform tag decides.
 */
import { titleTags } from '@quiesco/core';

/** The parts of a Vitest task used here (structural: no vitest import, unit-testable). */
export interface TaskLike {
  name: string;
  tags?: readonly string[] | undefined;
  suite?: TaskLike | undefined;
}

function own(node: TaskLike, parent: TaskLike | undefined): string[] {
  const inherited = new Set(parent?.tags ?? []);
  const native = (node.tags ?? []).filter((t) => !inherited.has(t));
  return [...new Set([...titleTags(node.name), ...native])];
}

export function tagLevelsOf(task: TaskLike): string[][] {
  const chain: TaskLike[] = [];
  for (let n: TaskLike | undefined = task; n !== undefined; n = n.suite) chain.unshift(n);
  return chain.map((n, i) => own(n, chain[i - 1]));
}

/** "suite > nested > test": the name of the test's artifacts directory. */
export function fullName(task: TaskLike): string {
  const names: string[] = [];
  for (let n: TaskLike | undefined = task; n !== undefined; n = n.suite) names.unshift(n.name);
  return names.join(' > ');
}
