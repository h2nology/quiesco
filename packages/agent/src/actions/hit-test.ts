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
  const text = n.displayText !== '' ? ` text="${n.displayText.slice(0, 40)}"` : '';
  return `<${n.type}${id}${text}>`;
}

/** Whether `n` is one of the hosts under `roots` (compared as rendered elements). */
function within(roots: readonly HostNode[], n: HostNode): boolean {
  const visit = (r: HostNode): boolean => r.isSameElement(n) || r.children.some(visit);
  return roots.some(visit);
}

/** A component above `n` (up to the root) whose name matches `re`. */
function ownedBy(n: HostNode, re: RegExp): boolean {
  for (let h: HostNode | null = n; h !== null; h = h.parent) if (h.ownerNames().some((name) => re.test(name))) return true;
  return false;
}

/**
 * What covers an element, for ELEMENT_OBSCURED. The hit test sees the whole app, also what React Native
 * draws over it outside <QuiescoRoot> (issue #38): LogBox's toast is named as such (dev builds keep the
 * component names, and LogBox exists only there).
 */
export function describeCover(top: HostNode, scoped: readonly HostNode[]): string {
  if (within(scoped, top)) return describe(top);
  if (ownedBy(top, /LogBox/)) {
    return `React Native's LogBox ${describe(top)}: the toast a console.error opened (appErrors.logBox: 'clear', the default, removes it on every soft reset; fix the error in the app)`;
  }
  return `${describe(top)}, drawn over the app outside <QuiescoRoot>`;
}

/**
 * Topmost host node whose rect contains `p` (later in render order = drawn on top; zIndex / elevation
 * are not considered). `pointerEvents: none` removes a subtree, `box-none` only the node itself. A host
 * that clips its content (scroll view, `overflow`) hides its descendants outside its rect (issue #45).
 */
export function hitTest(roots: readonly HostNode[], p: { x: number; y: number }): HostNode | null {
  let top: HostNode | null = null;
  const visit = (n: HostNode): void => {
    if (n.hiddenByStyle) return;
    const pe = n.props['pointerEvents'];
    if (pe === 'none') return;
    const r = n.measure();
    const inside = r !== null && r.width > 0 && r.height > 0 && contains(r, p);
    if (pe !== 'box-none' && inside) top = n;
    if (n.clipsContent && r !== null && !inside) return;
    for (const c of n.children) visit(c);
  };
  for (const r of roots) visit(r);
  return top;
}
