/**
 * Serialization of HostNodes: element summaries (query / assert results), the compact diagnostic
 * tree (`getTree`), and the structure hash used by the frame-stable tracker.
 */
import type { ElementSummary, JsonValue, Rect, TreeNode } from '@quiesco/protocol';

import type { HostNode, Viewport } from '../fiber-adapter';
import { checkedState, elementValue, isEnabled, isFocusedWidget, semanticType, widgetLabel } from './semantic';
import { visibleRatio } from './visibility';

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
  const ratio = visibleRatio(node, viewport, rect);
  const kind = semanticType(node);
  const s: ElementSummary = {
    type: node.type,
    text: node.text,
    rect,
    visible: ratio > 0,
    visibleRatio: Math.round(ratio * 1000) / 1000,
    focused: isFocusedWidget(node),
    enabled: isEnabled(node),
    props: serializableProps(node.props),
  };
  if (node.testID !== undefined) s.testID = node.testID;
  if (node.role !== undefined) s.role = node.role;
  const label = widgetLabel(node);
  if (label !== undefined) s.label = label;
  if (kind !== undefined) s.semanticType = kind;
  const checked = checkedState(node, kind);
  if (checked !== undefined) s.checked = checked;
  const value = elementValue(node, kind);
  if (value !== undefined) s.value = value;
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
  const kind = semanticType(node);
  if (kind !== undefined) t.semanticType = kind;
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
 * Structure snapshot for the frame-stable tracker (requirements.md §6.2-5): one line per host node in
 * tree order with its type, testID, text, rounded rect and child count. Two frames are stable when the
 * lines are equal; the lines also say which node changed when the tree never settles.
 */
export function structureLines(roots: readonly HostNode[], skip?: ReadonlySet<HostNode>): string[] {
  const lines: string[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const n = stack.pop() as HostNode;
    if (skip?.has(n) === true) continue; // and its subtree
    const r = n.measure();
    const rect = r === null ? '-' : `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    lines.push(`${n.type}${n.testID === undefined ? '' : `#${n.testID}`}${n.ownText === '' ? '' : ` ${JSON.stringify(n.ownText)}`} @${rect} children=${n.children.length}`);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as HostNode);
  }
  return lines;
}
