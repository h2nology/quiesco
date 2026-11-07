/**
 * Visibility rules (requirements.md §6.1). An element is visible when ALL of these hold:
 * 1. Neither it nor any ancestor host is hidden by style (`display: none` or `opacity: 0`).
 * 2. It can be measured and has a non-zero width and height.
 * 3. Its rect intersects the viewport (window) with a non-zero area. Partially on-screen counts as visible.
 *    If the viewport size is unknown, rule 3 is skipped.
 *
 * Not considered (documented limitations): being covered by another element, clipping by a scroll
 * container (`overflow: hidden`) other than the window, and transforms that move the element off-screen
 * after layout on platforms where the measured rect does not include them.
 */
import type { Rect } from '@quiesco/protocol';

import type { HostNode, Viewport } from '../fiber-adapter';

export function hiddenByAncestorStyle(node: HostNode): boolean {
  for (let n: HostNode | null = node; n !== null; n = n.parent) if (n.hiddenByStyle) return true;
  return false;
}

export function intersectsViewport(rect: Rect, viewport: Viewport): boolean {
  const w = Math.min(rect.x + rect.width, viewport.width) - Math.max(rect.x, 0);
  const h = Math.min(rect.y + rect.height, viewport.height) - Math.max(rect.y, 0);
  return w > 0 && h > 0;
}

export function isVisible(node: HostNode, viewport: Viewport | null, rect: Rect | null = node.measure()): boolean {
  if (hiddenByAncestorStyle(node)) return false;
  if (rect === null || rect.width <= 0 || rect.height <= 0) return false;
  return viewport === null || intersectsViewport(rect, viewport);
}
