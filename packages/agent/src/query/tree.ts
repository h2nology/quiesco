/**
 * Serialization of HostNodes: element summaries (query / assert results), the compact diagnostic
 * tree (`getTree`), and the structure hash used by the frame-stable tracker.
 */
import type { ElementSummary, JsonValue, Rect, TreeNode } from '@quiesco/protocol';

import type { HostNode, Viewport } from '../fiber-adapter';
import { isVisible } from './visibility';

/** Props never worth sending: structural, or huge and useless for assertions. */
const SKIPPED_PROPS = new Set(['children', 'style', 'collapsable', 'collapsableChildren']);
const MAX_DEPTH = 4;

function isReactElement(v: object): boolean {
  return '$$typeof' in v;
}

/** JSON-safe copy: drops functions, symbols, React elements and cycles; bounds depth. */
export function toJsonValue(v: unknown, depth = 0, seen: Set<object> = new Set()): JsonValue | undefined {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'object' || depth >= MAX_DEPTH || seen.has(v) || isReactElement(v)) return undefined;
  seen.add(v);
  try {
    if (Array.isArray(v)) return v.map((x) => toJsonValue(x, depth + 1, seen) ?? null);
    const out: Record<string, JsonValue> = {};
    for (const [k, x] of Object.entries(v)) {
      const j = toJsonValue(x, depth + 1, seen);
      if (j !== undefined) out[k] = j;
    }
    return out;
  } finally {
    seen.delete(v);
  }
}

export function serializableProps(props: Readonly<Record<string, unknown>>): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(props)) {
    if (SKIPPED_PROPS.has(k)) continue;
    const j = toJsonValue(v);
    if (j !== undefined) out[k] = j;
  }
  return out;
}

export function summarize(node: HostNode, viewport: Viewport | null): ElementSummary {
  const rect = node.measure();
  const s: ElementSummary = {
    type: node.type,
    text: node.text,
    rect,
    visible: isVisible(node, viewport, rect),
    props: serializableProps(node.props),
  };
  if (node.testID !== undefined) s.testID = node.testID;
  if (node.role !== undefined) s.role = node.role;
  if (node.label !== undefined) s.label = node.label;
  return s;
}

function roundRect(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}

export function toTreeNode(node: HostNode): TreeNode {
  const t: TreeNode = { type: node.type, children: node.children.map(toTreeNode) };
  if (node.testID !== undefined) t.testID = node.testID;
  const text = node.ownText;
  if (text !== '') t.text = text;
  if (node.role !== undefined) t.role = node.role;
  const rect = node.measure();
  if (rect !== null) t.rect = roundRect(rect);
  return t;
}

/** `getTree` result. Several top-level hosts are wrapped in a synthetic `root` node. */
export function getTree(roots: readonly HostNode[]): TreeNode | null {
  if (roots.length === 0) return null;
  if (roots.length === 1) return toTreeNode(roots[0] as HostNode);
  return { type: 'root', children: roots.map(toTreeNode) };
}

/**
 * Structure hash for the frame-stable tracker (requirements.md §6.2-5): type, testID, text and
 * rounded rect of every host node, in tree order. FNV-1a over the serialized string.
 */
export function structureHash(roots: readonly HostNode[]): string {
  let h = 0x811c9dc5;
  const feed = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const n = stack.pop() as HostNode;
    const r = n.measure();
    feed(`${n.type}|${n.testID ?? ''}|${n.ownText}|`);
    feed(r === null ? '-' : `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`);
    feed(`|${n.children.length};`);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as HostNode);
  }
  return (h >>> 0).toString(16);
}
