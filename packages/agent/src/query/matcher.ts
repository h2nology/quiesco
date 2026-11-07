/**
 * Matcher evaluation over the HostNode tree (requirements.md §6.1).
 *
 * - `id` / `label` / `role` compare the host's own props.
 * - `text` compares the concatenated text of the node's subtree. Because a container's text includes
 *   its children's text, only the DEEPEST matching nodes are returned: a node is dropped when one of
 *   its descendants also satisfies the whole matcher (e.g. `{ text: 'Login' }` returns the RCTText,
 *   not every View wrapping it).
 * - `within` restricts the search to descendants of the single element it matches.
 * - Results are in render (pre-order) order; `index` picks one of them.
 */
import type { ElementSummary, Matcher, TextMatch } from '@quiesco/protocol';

import { QuiescoError } from '../errors';
import type { HostNode } from '../fiber-adapter';

export function toRegExp(m: TextMatch): RegExp | string {
  return typeof m === 'string' ? m : new RegExp(m.regex.source, m.regex.flags);
}

function textMatches(value: string | undefined, pattern: TextMatch): boolean {
  if (value === undefined) return false;
  const p = toRegExp(pattern);
  if (typeof p === 'string') return value === p;
  p.lastIndex = 0;
  return p.test(value);
}

/** Whether `node` itself satisfies the matcher's own fields (`within` / `index` are not considered). */
export function matchesSelf(node: HostNode, m: Matcher): boolean {
  if (m.id !== undefined && node.testID !== m.id) return false;
  if (m.role !== undefined && node.role !== m.role) return false;
  if (m.label !== undefined && !textMatches(node.label, m.label)) return false;
  if (m.text !== undefined && !textMatches(node.text, m.text)) return false;
  return true;
}

function* preorder(nodes: readonly HostNode[]): Generator<HostNode> {
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const n = stack.pop() as HostNode;
    yield n;
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as HostNode);
  }
}

function hasMatchingDescendant(node: HostNode, m: Matcher): boolean {
  for (const d of preorder(node.children)) if (matchesSelf(d, m)) return true;
  return false;
}

/** All nodes matching `m` (ignoring `index`) under `roots`. Throws if `within` is missing or ambiguous. */
export function findAllIgnoringIndex(roots: readonly HostNode[], m: Matcher): HostNode[] {
  let scope = roots;
  if (m.within !== undefined) scope = resolveOne(roots, m.within).children;
  const out: HostNode[] = [];
  for (const n of preorder(scope)) {
    if (!matchesSelf(n, m)) continue;
    if (m.text !== undefined && hasMatchingDescendant(n, m)) continue;
    out.push(n);
  }
  return out;
}

/**
 * Elements for `m`. With `index`, at most one element (empty if out of range).
 * Assertions use this directly and apply their own semantics to the count.
 */
export function findAll(roots: readonly HostNode[], m: Matcher): HostNode[] {
  const all = findAllIgnoringIndex(roots, m);
  if (m.index === undefined) return all;
  const picked = all[m.index];
  return picked === undefined ? [] : [picked];
}

export type Summarizer = (node: HostNode) => ElementSummary;

/**
 * Exactly one element, for actions and `within`: ELEMENT_NOT_FOUND / MULTIPLE_MATCHES otherwise.
 * `summarize` is used to list the candidates in MULTIPLE_MATCHES.
 */
export function resolveOne(roots: readonly HostNode[], m: Matcher, summarize?: Summarizer): HostNode {
  const found = findAll(roots, m);
  if (found.length === 0) throw new QuiescoError('ELEMENT_NOT_FOUND', `No element matches ${describeMatcher(m)}`, { matcher: m });
  if (found.length > 1) {
    throw new QuiescoError(
      'MULTIPLE_MATCHES',
      `${found.length} elements match ${describeMatcher(m)}; add \`index\` or a more specific matcher`,
      { matcher: m, matches: summarize === undefined ? [] : found.map(summarize) },
    );
  }
  return found[0] as HostNode;
}

function fmt(t: TextMatch): string {
  return typeof t === 'string' ? JSON.stringify(t) : `/${t.regex.source}/${t.regex.flags}`;
}

/** Human-readable matcher, e.g. `{ id: "submit", within: { id: "form" } }`. */
export function describeMatcher(m: Matcher): string {
  const parts: string[] = [];
  if (m.id !== undefined) parts.push(`id: ${JSON.stringify(m.id)}`);
  if (m.text !== undefined) parts.push(`text: ${fmt(m.text)}`);
  if (m.label !== undefined) parts.push(`label: ${fmt(m.label)}`);
  if (m.role !== undefined) parts.push(`role: ${JSON.stringify(m.role)}`);
  if (m.within !== undefined) parts.push(`within: ${describeMatcher(m.within)}`);
  if (m.index !== undefined) parts.push(`index: ${m.index}`);
  return `{ ${parts.join(', ')} }`;
}
