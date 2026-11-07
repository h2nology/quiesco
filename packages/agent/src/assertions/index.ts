/**
 * Assertion evaluation (requirements.md §6.4). One evaluation is a pure check of the current tree; the
 * runtime retries it until it passes or the timeout expires.
 *
 * Semantics with several matches (no `index`):
 * - visible: at least one match is visible. notVisible: no match is visible (no match at all passes).
 * - exists: at least one match. notExists: no match. count: number of matches.
 * - text / prop: exactly one match is required; otherwise the assertion fails (and is retried).
 */
import type { AssertionSpec, ElementSummary, JsonValue, TextMatch } from '@quiesco/protocol';

import { QuiescoError } from '../errors';
import type { HostNode, Viewport } from '../fiber-adapter';
import { findAll, summarize, toJsonValue, toRegExp } from '../query';

export interface Evaluation {
  pass: boolean;
  expected: JsonValue;
  actual: JsonValue;
  elements: ElementSummary[];
}

function describeText(t: TextMatch): string {
  return typeof t === 'string' ? t : `/${t.regex.source}/${t.regex.flags}`;
}

function textMatches(value: string, pattern: TextMatch): boolean {
  const p = toRegExp(pattern);
  if (typeof p === 'string') return value === p;
  p.lastIndex = 0;
  return p.test(value);
}

/** A prop as the user wrote it: host props first, then the owning composite (e.g. Pressable `disabled`). */
export function readProp(node: HostNode, prop: string): unknown {
  const own = node.props[prop];
  return own !== undefined ? own : node.ownerProps()[prop];
}

export function jsonEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  const ka = Object.keys(a);
  const ao = a as Record<string, JsonValue>;
  const bo = b as Record<string, JsonValue>;
  return ka.length === Object.keys(bo).length && ka.every((k) => jsonEqual(ao[k], bo[k]));
}

function single(nodes: HostNode[]): HostNode | string {
  if (nodes.length === 1) return nodes[0] as HostNode;
  return nodes.length === 0 ? 'no matching element' : `${nodes.length} matching elements (add index or narrow the matcher)`;
}

export function evaluate(roots: readonly HostNode[], spec: AssertionSpec, viewport: Viewport | null): Evaluation {
  let nodes: HostNode[];
  try {
    nodes = findAll(roots, spec.matcher);
  } catch (e) {
    // `within` did not resolve to exactly one element: same as "no match" for this evaluation.
    if (!(e instanceof QuiescoError)) throw e;
    if (spec.type === 'notExists' || spec.type === 'notVisible') return { pass: true, expected: spec.type, actual: e.message, elements: [] };
    return { pass: false, expected: spec.type, actual: e.message, elements: [] };
  }
  const elements = nodes.map((n) => summarize(n, viewport));

  switch (spec.type) {
    case 'visible': {
      const pass = elements.some((e) => e.visible);
      return { pass, expected: 'visible', actual: nodes.length === 0 ? 'no matching element' : pass ? 'visible' : 'not visible', elements };
    }
    case 'notVisible': {
      const n = elements.filter((e) => e.visible).length;
      return { pass: n === 0, expected: 'not visible', actual: n === 0 ? 'not visible' : `${n} visible element(s)`, elements };
    }
    case 'exists':
      return { pass: nodes.length > 0, expected: 'exists', actual: nodes.length > 0 ? `${nodes.length} element(s)` : 'no matching element', elements };
    case 'notExists':
      return { pass: nodes.length === 0, expected: 'does not exist', actual: nodes.length === 0 ? 'no matching element' : `${nodes.length} element(s)`, elements };
    case 'count':
      return { pass: nodes.length === spec.expected, expected: spec.expected, actual: nodes.length, elements };
    case 'text': {
      const n = single(nodes);
      const expected = describeText(spec.expected);
      if (typeof n === 'string') return { pass: false, expected, actual: n, elements };
      return { pass: textMatches(n.text, spec.expected), expected, actual: n.text, elements };
    }
    case 'prop': {
      const n = single(nodes);
      if (typeof n === 'string') return { pass: false, expected: spec.expected, actual: n, elements };
      const actual = toJsonValue(readProp(n, spec.prop));
      return { pass: jsonEqual(actual, spec.expected), expected: spec.expected, actual: actual ?? null, elements };
    }
  }
}

export function assertionMessage(spec: AssertionSpec, ev: Evaluation, timeoutMs: number, matcherText: string): string {
  const what = spec.type === 'prop' ? `prop "${spec.prop}" of ${matcherText}` : matcherText;
  return `expect ${spec.type} failed after ${timeoutMs}ms for ${what}: expected ${JSON.stringify(ev.expected)}, actual ${JSON.stringify(ev.actual)}`;
}
