import type { JsonValue } from './json.js';
import type { Matcher, TextMatch } from './matcher.js';

/** Assertions from requirements.md §6.4. Evaluated by the agent, retried until they pass or time out. */
export type AssertionSpec =
  | { type: 'visible'; matcher: Matcher }
  | { type: 'notVisible'; matcher: Matcher }
  | { type: 'exists'; matcher: Matcher }
  | { type: 'notExists'; matcher: Matcher }
  | { type: 'text'; matcher: Matcher; expected: TextMatch }
  | { type: 'prop'; matcher: Matcher; prop: string; expected: JsonValue }
  | { type: 'count'; matcher: Matcher; expected: number };

export type AssertionType = AssertionSpec['type'];
