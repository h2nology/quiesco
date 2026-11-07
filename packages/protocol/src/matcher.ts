/** A regular expression in JSON form (RegExp itself is not serializable). */
export interface RegexPattern {
  regex: { source: string; flags: string };
}

/** Exact string or regular expression. */
export type TextMatch = string | RegexPattern;

/**
 * Element query (requirements.md §6.1). All given fields must match.
 * Only host components (views that end up as native views / DOM nodes) are returned.
 */
export interface Matcher {
  /** `testID`, exact match. */
  id?: string;
  /** Text content of the element (concatenated text of its subtree). */
  text?: TextMatch;
  /** `accessibilityLabel` / `aria-label`. */
  label?: TextMatch;
  /** `accessibilityRole` / `role`. */
  role?: string;
  /** Restrict the search to descendants of the (single) element matched by this matcher. */
  within?: Matcher;
  /** Pick the n-th match (0-based) when several elements match. */
  index?: number;
}
