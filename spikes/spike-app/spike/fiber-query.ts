/**
 * S1 spike: walk the fiber tree, find host components by testID, measure them.
 * In the real agent ALL of this lives in packages/agent/src/fiber-adapter/.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { spikeState } from './devtools-hook';

// React 19 WorkTag values (ReactWorkTags.js): HostRoot=3, HostComponent=5, HostText=6,
// HostHoistable=26, HostSingleton=27 (the last two are react-dom only).
const HostComponent = 5;
const HostText = 6;

export type HostMatch = {
  type: string;
  testID?: string;
  text: string;
  role?: string;
  fiber: any;
};

function* walk(fiber: any): Generator<any> {
  let node = fiber;
  while (node) {
    yield node;
    if (node.child) yield* walk(node.child);
    node = node.sibling;
  }
}

function collectText(fiber: any): string {
  let out = '';
  for (const f of walk(fiber.child)) {
    if (f.tag === HostText && typeof f.memoizedProps === 'string') out += f.memoizedProps;
  }
  return out;
}

export function allRoots(): any[] {
  const out: any[] = [];
  spikeState.roots.forEach((set) => set.forEach((r) => out.push(r)));
  return out;
}

export function findHostByTestID(testID: string): HostMatch[] {
  const matches: HostMatch[] = [];
  for (const root of allRoots()) {
    for (const f of walk(root.current)) {
      if (f.tag === HostComponent && f.memoizedProps?.testID === testID) {
        matches.push({
          type: String(f.type),
          testID,
          text: collectText(f),
          role: f.memoizedProps?.accessibilityRole ?? f.memoizedProps?.role,
          fiber: f,
        });
      }
    }
  }
  return matches;
}

export function hostSummary(): { type: string; testID?: string; text: string }[] {
  const out: { type: string; testID?: string; text: string }[] = [];
  for (const root of allRoots()) {
    for (const f of walk(root.current)) {
      if (f.tag === HostComponent) out.push({ type: String(f.type), testID: f.memoizedProps?.testID, text: collectText(f) });
    }
  }
  return out;
}
