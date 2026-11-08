/**
 * Visibility rules (requirements.md §6.1; clipping added in Phase 6.1). The visible part of an
 * element is its rect intersected with:
 * - the viewport (window), when its size is known;
 * - every ancestor that clips its content: scroll views and `overflow` other than `visible`.
 *
 * `visibleRatio` = visible area / element area. An element is visible when the ratio is > 0 and
 * neither it nor an ancestor is hidden by style (`display: none` / `opacity: 0`).
 *
 * Not considered (documented limitations): being covered by another element (actions check that
 * separately, ELEMENT_OBSCURED), and transforms not reflected in the measured rect.
 */
import type { Rect } from '@quiesco/protocol';

import type { HostNode, Viewport } from '../fiber-adapter';

export function hiddenByAncestorStyle(node: HostNode): boolean {
  for (let n: HostNode | null = node; n !== null; n = n.parent) if (n.hiddenByStyle) return true;
  return false;
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.width, b.x + b.width) - x;
  const h = Math.min(a.y + a.height, b.y + b.height) - y;
  return w > 0 && h > 0 ? { x, y, width: w, height: h } : null;
}

export function intersectsViewport(rect: Rect, viewport: Viewport): boolean {
  return intersect(rect, { x: 0, y: 0, width: viewport.width, height: viewport.height }) !== null;
}

/**
 * The part of `rect` not clipped by the viewport or by clipping ancestors of `node`, or null when
 * nothing is left. Ancestors that cannot be measured do not clip.
 */
export function visiblePart(node: HostNode, viewport: Viewport | null, rect: Rect): Rect | null {
  let part: Rect | null = rect;
  if (viewport !== null) part = intersect(part, { x: 0, y: 0, width: viewport.width, height: viewport.height });
  for (let a = node.parent; a !== null && part !== null; a = a.parent) {
    if (!a.clipsContent) continue;
    const clip = a.measure();
    if (clip !== null) part = intersect(part, clip);
  }
  return part;
}

/** Visible fraction of the element's area, 0–1. */
export function visibleRatio(node: HostNode, viewport: Viewport | null, rect: Rect | null = node.measure()): number {
  if (hiddenByAncestorStyle(node)) return 0;
  if (rect === null || rect.width <= 0 || rect.height <= 0) return 0;
  const part = visiblePart(node, viewport, rect);
  if (part === null) return 0;
  return Math.min(1, (part.width * part.height) / (rect.width * rect.height));
}

export function isVisible(node: HostNode, viewport: Viewport | null, rect: Rect | null = node.measure()): boolean {
  return visibleRatio(node, viewport, rect) > 0;
}
