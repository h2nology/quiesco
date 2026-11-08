import type { JsonValue } from './json.js';
import type { Matcher, TextMatch } from './matcher.js';

/**
 * Assertions from requirements.md §6.4. Evaluated by the agent, retried until they pass or time out.
 * `not: true` negates text / prop / count / value / label (the single-element ones still need exactly
 * one match); the other assertions come in pairs.
 */
export type AssertionSpec =
  /** `ratio`: minimum visible fraction of the element's area (0–1]; default: any part visible. */
  | { type: 'visible'; matcher: Matcher; ratio?: number }
  /** No match shows `ratio` of its area (default: no match is visible at all). */
  | { type: 'notVisible'; matcher: Matcher; ratio?: number }
  | { type: 'exists'; matcher: Matcher }
  | { type: 'notExists'; matcher: Matcher }
  | { type: 'text'; matcher: Matcher; expected: TextMatch; not?: boolean }
  | { type: 'prop'; matcher: Matcher; prop: string; expected: JsonValue; not?: boolean }
  | { type: 'count'; matcher: Matcher; expected: number; not?: boolean }
  | { type: 'focused'; matcher: Matcher }
  | { type: 'notFocused'; matcher: Matcher }
  | { type: 'enabled'; matcher: Matcher }
  | { type: 'disabled'; matcher: Matcher }
  | { type: 'checked'; matcher: Matcher }
  | { type: 'notChecked'; matcher: Matcher }
  /** The element's value (TextInput text, Switch / Slider / Picker value, accessibilityValue). */
  | { type: 'value'; matcher: Matcher; expected: JsonValue | TextMatch; not?: boolean }
  | { type: 'label'; matcher: Matcher; expected: TextMatch; not?: boolean };

export type AssertionType = AssertionSpec['type'];
