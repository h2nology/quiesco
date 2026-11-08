/**
 * User-facing matcher: like the protocol Matcher, but `id` / `text` / `label` accept a RegExp, and a
 * bare string means a testID (`app.tap('submit')`).
 */
import type { Matcher, SemanticType, TextMatch } from '@quiesco/protocol';

export type TextQuery = string | RegExp;

export interface ElementQuery {
  /** testID: exact string or RegExp. */
  id?: TextQuery;
  /** Text of the element's subtree (the deepest matching element is returned). */
  text?: TextQuery;
  /** accessibilityLabel / aria-label. */
  label?: TextQuery;
  /** accessibilityRole / role. */
  role?: string;
  /**
   * A semantic type (`'button'`, `'input'`, `'switch'`, ...: the same on every platform), a host
   * component type (`'RCTView'`, `'div'`) or the displayName of a component rendering the element.
   */
  type?: SemanticType | (string & {});
  /** Some descendant matches (Detox `withDescendant`). */
  has?: ElementQuery | string;
  /** The element itself does not match. */
  not?: ElementQuery | string;
  /** Inside the single element matched by this matcher (Detox `withAncestor`). */
  within?: ElementQuery | string;
  /** n-th match (0-based) in render order, the same order on every platform. */
  index?: number;
}

export type MatcherInput = ElementQuery | string;

export function toTextMatch(t: TextQuery): TextMatch {
  return typeof t === 'string' ? t : { regex: { source: t.source, flags: t.flags } };
}

export function toMatcher(input: MatcherInput): Matcher {
  if (typeof input === 'string') return { id: input };
  const m: Matcher = {};
  if (input.id !== undefined) m.id = toTextMatch(input.id);
  if (input.text !== undefined) m.text = toTextMatch(input.text);
  if (input.label !== undefined) m.label = toTextMatch(input.label);
  if (input.role !== undefined) m.role = input.role;
  if (input.type !== undefined) m.type = input.type;
  if (input.has !== undefined) m.has = toMatcher(input.has);
  if (input.not !== undefined) m.not = toMatcher(input.not);
  if (input.within !== undefined) m.within = toMatcher(input.within);
  if (input.index !== undefined) m.index = input.index;
  return m;
}
