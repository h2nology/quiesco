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
  // react-dom does not create HostText fibers when a host's children is a single string/number
  // (shouldSetTextContent); the text then lives in memoizedProps.children. Fabric always creates HostText.
  // Only when the host has no child fibers; otherwise Fabric's HostText children would be counted twice.
  const own = (f: any) => {
    if (f.child) return '';
    const c = f.memoizedProps?.children;
    return typeof c === 'string' || typeof c === 'number' ? String(c) : '';
  };
  let out = own(fiber);
  for (const f of walk(fiber.child)) {
    if (f.tag === HostText && typeof f.memoizedProps === 'string') out += f.memoizedProps;
    else if (f.tag === HostComponent) out += own(f);
  }
  return out;
}

/** S7: testID as seen on the HOST fiber's React props: `testID` (Fabric) or `data-testid` (react-native-web). */
export function hostTestID(f: any): string | undefined {
  const p = f.memoizedProps;
  return p?.testID ?? p?.['data-testid'];
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
      if (f.tag === HostComponent && hostTestID(f) === testID) {
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

/**
 * S7: renderer-agnostic lookup. Find any fiber whose props carry testID (host or composite),
 * then resolve to itself if it is a host component, else its first host descendant.
 * On react-native-web the host <div> only has data-testid; testID stays on the RNW composite.
 */
export function findByTestIDUnified(testID: string): HostMatch[] {
  const seen = new Set<any>();
  const matches: HostMatch[] = [];
  for (const root of allRoots()) {
    for (const f of walk(root.current)) {
      if (f.memoizedProps == null || typeof f.memoizedProps !== 'object' || f.memoizedProps.testID !== testID) continue;
      let host: any = f.tag === HostComponent ? f : null;
      if (!host) {
        for (const d of walk(f.child)) {
          if (d.tag === HostComponent) {
            host = d;
            break;
          }
        }
      }
      if (host && !seen.has(host)) {
        seen.add(host);
        matches.push({ type: String(host.type), testID, text: collectText(host), role: f.memoizedProps.accessibilityRole ?? f.memoizedProps.role, fiber: host });
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
