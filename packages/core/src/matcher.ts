/**
 * User-facing matcher: like the protocol Matcher, but `text` / `label` accept a RegExp, and a bare
 * string means a testID (`app.tap('submit')`).
 */
import type { Matcher, TextMatch } from '@quiesco/protocol';

export type TextQuery = string | RegExp;

export interface ElementQuery {
  id?: string;
  text?: TextQuery;
  label?: TextQuery;
  role?: string;
  within?: ElementQuery | string;
  index?: number;
}

export type MatcherInput = ElementQuery | string;

export function toTextMatch(t: TextQuery): TextMatch {
  return typeof t === 'string' ? t : { regex: { source: t.source, flags: t.flags } };
}

export function toMatcher(input: MatcherInput): Matcher {
  if (typeof input === 'string') return { id: input };
  const m: Matcher = {};
  if (input.id !== undefined) m.id = input.id;
  if (input.text !== undefined) m.text = toTextMatch(input.text);
  if (input.label !== undefined) m.label = toTextMatch(input.label);
  if (input.role !== undefined) m.role = input.role;
  if (input.within !== undefined) m.within = toMatcher(input.within);
  if (input.index !== undefined) m.index = input.index;
  return m;
}
