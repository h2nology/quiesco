/**
 * cucumber-js on top of core's runner-independent Lifecycle (requirements.md §6.10): Gherkin tag levels
 * and `--parallel` workers (Phase 6.12). Kept free of cucumber imports so it can be unit-tested.
 */
import { Lifecycle as CoreLifecycle } from '@quiesco/core';
import type { LifecycleOptions as CoreOptions, WorkerInfo } from '@quiesco/core';

export type { Attachment, ScenarioResult } from '@quiesco/core';
export type LifecycleOptions = CoreOptions;

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

/**
 * The worker this thread is: cucumber-js `--parallel N` runs N worker threads and sets
 * CUCUMBER_WORKER_ID ("0"…) and CUCUMBER_TOTAL_WORKERS in each one's environment (findings 4.6).
 */
export function cucumberWorker(env: NodeJS.ProcessEnv): WorkerInfo {
  const count = Number.parseInt(env['CUCUMBER_TOTAL_WORKERS'] ?? '', 10);
  const index = Number.parseInt(env['CUCUMBER_WORKER_ID'] ?? '', 10);
  if (!(count > 1) || !(index >= 0)) return { index: 0, count: 1 };
  return { index, count };
}

export class Lifecycle extends CoreLifecycle {
  constructor(options: LifecycleOptions = {}) {
    super({ worker: cucumberWorker(options.env ?? process.env), ...options });
  }
}
