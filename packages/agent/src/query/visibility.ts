/**
 * Visibility rules (requirements.md §6.1; clipping added in Phase 6.1). The visible part of an
 * element is its rect intersected with:
 * - the viewport (window), when its size is known;
 * - every ancestor that clips its content: scroll views and `overflow` other than `visible`.
 *
 * `visibleRatio` = visible area / element area. An element is visible when the ratio is > 0 and
 * neither it nor an ancestor is hidden by style (`display: none` / `opacity: 0`).
 *
 * Screens (react-native-screens, iOS / Android): an element on a screen that is not on top is not
 * visible (issue #2). A native stack keeps the screens below in the React tree with their layout, but
 * detached from the window; a later screen in the same `RNSScreenStack` covers them, unless it is
 * presented transparently. Inactive screens of a ScreenContainer (tabs) have `activityState` 0.
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

/** Presentations that leave the screen below visible. */
const TRANSPARENT = new Set(['transparentModal', 'containedTransparentModal']);

/** The react-native-screens screen containing `node` that is not on top, or null. */
export function screenNotOnTop(node: HostNode): HostNode | null {
  for (let a = node.parent; a !== null; a = a.parent) {
    if (a.type !== 'RNSScreen') continue;
    const state = a.props['activityState'];
    if (typeof state === 'number' && state === 0) return a;
    const stack = a.parent;
    if (stack === null || stack.type !== 'RNSScreenStack') continue;
    const later = stack.children.slice(stack.children.indexOf(a) + 1);
    if (later.some((s) => s.type === 'RNSScreen' && !TRANSPARENT.has(String(s.props['stackPresentation'] ?? 'push')))) return a;
  }
  return null;
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
  if (hiddenByAncestorStyle(node) || screenNotOnTop(node) !== null) return 0;
  if (rect === null || rect.width <= 0 || rect.height <= 0) return 0;
  const part = visiblePart(node, viewport, rect);
  if (part === null) return 0;
  return Math.min(1, (part.width * part.height) / (rect.width * rect.height));
}

export function isVisible(node: HostNode, viewport: Viewport | null, rect: Rect | null = node.measure()): boolean {
  return visibleRatio(node, viewport, rect) > 0;
}

function describeHost(n: HostNode): string {
  return `<${n.type}${n.testID === undefined ? '' : ` testID="${n.testID}"`}>`;
}

/**
 * Why an element is not visible, in words (issue #2), or null when it is visible. Checked in the order a
 * reader would look: a screen that is not on top, hidden by style (itself or an ancestor), not laid out,
 * no size, outside the window, clipped by a scroll view or `overflow`.
 */
export function invisibleReason(node: HostNode, viewport: Viewport | null, rect: Rect | null = node.measure()): string | null {
  if (screenNotOnTop(node) !== null) return 'it is on a screen that is not on top (another screen covers it)';
  if (node.hiddenByStyle) return 'it is hidden by its style (display: none or opacity: 0)';
  for (let a = node.parent; a !== null; a = a.parent) {
    if (a.hiddenByStyle) return `an ancestor ${describeHost(a)} is hidden (display: none or opacity: 0), e.g. a screen that is not on top`;
  }
  if (rect === null) return 'it is not laid out (it cannot be measured)';
  if (rect.width <= 0 || rect.height <= 0) return `it has no size (${Math.round(rect.width)}×${Math.round(rect.height)})`;
  if (viewport !== null && !intersectsViewport(rect, viewport)) {
    return `it is outside the window (at ${Math.round(rect.x)},${Math.round(rect.y)}; the window is ${Math.round(viewport.width)}×${Math.round(viewport.height)}): scroll to it`;
  }
  if (visiblePart(node, viewport, rect) === null) return 'it is clipped by a scroll view or an `overflow` ancestor: scroll to it';
  return null;
}
