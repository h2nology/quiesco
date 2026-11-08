/** Geometry shared by the action performers: centers, hit testing, element descriptions. */
import type { Rect } from '@quiesco/protocol';

import type { HostNode } from '../fiber-adapter';

export function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function contains(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
}

/** Whether `a` is `b` or one of its ancestors (compared as rendered elements, not objects). */
export function isAncestor(a: HostNode, b: HostNode): boolean {
  for (let n: HostNode | null = b; n !== null; n = n.parent) if (a.isSameElement(n)) return true;
  return false;
}

export function describe(n: HostNode): string {
  const id = n.testID !== undefined ? ` testID="${n.testID}"` : '';
  const text = n.text !== '' ? ` text="${n.text.slice(0, 40)}"` : '';
  return `<${n.type}${id}${text}>`;
}

/**
 * Topmost host node whose rect contains `p` (later in render order = drawn on top; zIndex / elevation
 * are not considered). `pointerEvents: none` removes a subtree, `box-none` only the node itself.
 */
export function hitTest(roots: readonly HostNode[], p: { x: number; y: number }): HostNode | null {
  let top: HostNode | null = null;
  const visit = (n: HostNode): void => {
    if (n.hiddenByStyle) return;
    const pe = n.props['pointerEvents'];
    if (pe === 'none') return;
    const r = n.measure();
    if (pe !== 'box-none' && r !== null && r.width > 0 && r.height > 0 && contains(r, p)) top = n;
    for (const c of n.children) visit(c);
  };
  for (const r of roots) visit(r);
  return top;
}
