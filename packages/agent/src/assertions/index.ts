/**
 * Assertion evaluation (requirements.md §6.4). One evaluation is a pure check of the current tree; the
 * runtime retries it until it passes or the timeout expires.
 *
 * Semantics with several matches (no `index`):
 * - visible: at least one match is visible. notVisible: no match is visible (no match at all passes).
 * - exists: at least one match. notExists: no match. count: number of matches.
 * - text / prop / focused / enabled / checked / value / label (and their negations): exactly one match
 *   is required; otherwise the assertion fails (and is retried).
 * - visible with `ratio`: at least one match shows at least that fraction of its area.
 */
import type { AssertionSpec, ElementSummary, JsonValue, TextMatch } from '@quiesco/protocol';

import { QuiescoError } from '../errors';
import type { HostNode, Viewport } from '../fiber-adapter';
import { findAll, summarize, toJsonValue, toRegExp } from '../query';

function isTextMatch(v: unknown): v is TextMatch {
  return typeof v === 'string' || (typeof v === 'object' && v !== null && !Array.isArray(v) && 'regex' in v && Object.keys(v).length === 1);
}

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
  const ev = evaluatePositive(roots, spec, viewport);
  if (!('not' in spec) || spec.not !== true) return ev;
  // Negated single-element assertions still need exactly one element to say anything about it.
  const needsOne = spec.type !== 'count';
  if (needsOne && ev.elements.length !== 1) return { ...ev, pass: false, expected: `not ${JSON.stringify(ev.expected)}` };
  return { ...ev, pass: !ev.pass, expected: `not ${JSON.stringify(ev.expected)}` };
}

function evaluatePositive(roots: readonly HostNode[], spec: AssertionSpec, viewport: Viewport | null): Evaluation {
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

  /** Single-element state assertions: `pick` reads the state from the element's summary. */
  const stateOf = (expected: JsonValue, pick: (e: ElementSummary) => JsonValue | undefined, ok: (actual: JsonValue | undefined) => boolean): Evaluation => {
    const n = single(nodes);
    if (typeof n === 'string') return { pass: false, expected, actual: n, elements };
    const actual = pick(elements[0] as ElementSummary);
    return { pass: ok(actual), expected, actual: actual ?? null, elements };
  };

  switch (spec.type) {
    case 'visible': {
      if (spec.ratio !== undefined) {
        const ratio = spec.ratio;
        const best = elements.reduce((m, e) => Math.max(m, e.visibleRatio), 0);
        const pass = elements.some((e) => e.visibleRatio >= ratio);
        const actual = nodes.length === 0 ? 'no matching element' : `${Math.round(best * 100)}% visible`;
        return { pass, expected: `at least ${Math.round(ratio * 100)}% visible`, actual, elements };
      }
      const pass = elements.some((e) => e.visible);
      return { pass, expected: 'visible', actual: nodes.length === 0 ? 'no matching element' : pass ? 'visible' : 'not visible', elements };
    }
    case 'focused':
      return stateOf('focused', (e) => (e.focused ? 'focused' : 'not focused'), (a) => a === 'focused');
    case 'notFocused':
      return stateOf('not focused', (e) => (e.focused ? 'focused' : 'not focused'), (a) => a === 'not focused');
    case 'enabled':
      return stateOf('enabled', (e) => (e.enabled ? 'enabled' : 'disabled'), (a) => a === 'enabled');
    case 'disabled':
      return stateOf('disabled', (e) => (e.enabled ? 'enabled' : 'disabled'), (a) => a === 'disabled');
    case 'checked':
      return stateOf(true, (e) => e.checked, (a) => a === true);
    case 'notChecked':
      return stateOf(false, (e) => e.checked, (a) => a === false);
    case 'label':
      return stateOf(describeText(spec.expected), (e) => e.label, (a) => typeof a === 'string' && textMatches(a, spec.expected));
    case 'value': {
      const expected = spec.expected;
      if (isTextMatch(expected) && typeof expected !== 'string') {
        return stateOf(describeText(expected), (e) => e.value, (a) => typeof a === 'string' && textMatches(a, expected));
      }
      return stateOf(expected as JsonValue, (e) => e.value, (a) => jsonEqual(a, expected as JsonValue));
    }
    case 'notVisible': {
      if (spec.ratio !== undefined) {
        const ratio = spec.ratio;
        const n = elements.filter((e) => e.visibleRatio >= ratio).length;
        return { pass: n === 0, expected: `less than ${Math.round(ratio * 100)}% visible`, actual: n === 0 ? 'not visible enough' : `${n} element(s) at least ${Math.round(ratio * 100)}% visible`, elements };
      }
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
  if (spec.type === 'checked' || spec.type === 'notChecked') {
    return `expect ${spec.type} failed after ${timeoutMs}ms for ${what}: expected checked=${JSON.stringify(ev.expected)}, actual ${ev.actual === null ? 'no checked state (not a switch, checkbox or radio, and no accessibilityState.checked)' : JSON.stringify(ev.actual)}`;
  }
  return `expect ${spec.type} failed after ${timeoutMs}ms for ${what}: expected ${JSON.stringify(ev.expected)}, actual ${JSON.stringify(ev.actual)}`;
}
