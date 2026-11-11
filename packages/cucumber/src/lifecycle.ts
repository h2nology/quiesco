/**
 * cucumber-js on top of core's runner-independent Lifecycle (requirements.md §6.10): Gherkin tag levels
 * and the refusal of `--parallel`. Kept free of cucumber imports so it can be unit-tested.
 */
import { Lifecycle as CoreLifecycle } from '@quiesco/core';
import type { LifecycleOptions as CoreOptions } from '@quiesco/core';

export type { Attachment, ScenarioResult } from '@quiesco/core';
export type LifecycleOptions = Omit<CoreOptions, 'checkSerial'>;

interface TaggedNode {
  tags: readonly { id: string }[];
}
interface ScenarioNode extends TaggedNode {
  examples: readonly TaggedNode[];
}
interface FeatureChild {
  rule?: TaggedNode & { children: readonly FeatureChild[] };
  scenario?: ScenarioNode;
}
/** The parts of a cucumber-js GherkinDocument needed to place tags (structural, no cucumber import). */
export interface TagSource {
  feature?: (TaggedNode & { children: readonly FeatureChild[] }) | undefined;
}

/**
 * A pickle's tags grouped by Gherkin level: [feature, rule, scenario, examples]. Tags whose node is
 * not found count as scenario tags.
 */
export function tagLevels(pickleTags: readonly { name: string; astNodeId: string }[], doc: TagSource): string[][] {
  const level = new Map<string, number>();
  const mark = (node: TaggedNode, l: number) => node.tags.forEach((t) => level.set(t.id, l));
  const walk = (children: readonly FeatureChild[]) => {
    for (const c of children) {
      if (c.rule !== undefined) {
        mark(c.rule, 1);
        walk(c.rule.children);
      }
      if (c.scenario !== undefined) {
        mark(c.scenario, 2);
        c.scenario.examples.forEach((e) => mark(e, 3));
      }
    }
  };
  if (doc.feature !== undefined) {
    mark(doc.feature, 0);
    walk(doc.feature.children);
  }
  const out: string[][] = [[], [], [], []];
  for (const t of pickleTags) out[level.get(t.astNodeId) ?? 2]?.push(t.name);
  return out;
}

/** cucumber-js --parallel runs worker threads that would all launch the same device and port. */
export function cucumberParallel(env: NodeJS.ProcessEnv): string | null {
  return Number.parseInt(env['CUCUMBER_TOTAL_WORKERS'] ?? '1', 10) > 1
    ? 'Quiesco does not support cucumber-js --parallel: every worker would drive the same device. Run the features serially (drop --parallel).'
    : null;
}

export class Lifecycle extends CoreLifecycle {
  constructor(options: LifecycleOptions = {}) {
    super({ ...options, checkSerial: cucumberParallel });
  }
}
