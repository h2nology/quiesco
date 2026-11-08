/** A regular expression in JSON form (RegExp itself is not serializable). */
export interface RegexPattern {
  regex: { source: string; flags: string };
}

/** Exact string or regular expression. */
export type TextMatch = string | RegexPattern;

/**
 * Platform-independent element kinds (requirements.md §6.1, Phase 6.1). Derived from the host
 * component type, the accessibility role and the props of the owning component; the same element
 * gets the same kind on iOS, Android and the web.
 */
export const SEMANTIC_TYPES = [
  'button',
  'link',
  'header',
  'text',
  'input',
  'image',
  'switch',
  'checkbox',
  'radio',
  'slider',
  'picker',
  'progress',
  'scroll',
  'list',
] as const;

export type SemanticType = (typeof SEMANTIC_TYPES)[number];

/**
 * Element query (requirements.md §6.1). All given fields must match.
 * Only host components (views that end up as native views / DOM nodes) are returned.
 */
export interface Matcher {
  /** `testID`: exact string or regular expression. */
  id?: TextMatch;
  /** Text content of the element (concatenated text of its subtree). */
  text?: TextMatch;
  /** `accessibilityLabel` / `aria-label`. */
  label?: TextMatch;
  /** `accessibilityRole` / `role`. */
  role?: string;
  /**
   * A semantic type (`'button'`, `'input'`, ... see SEMANTIC_TYPES), a host component type
   * (`'RCTView'`, `'div'`) or the display name of a component that renders the element (`'Pressable'`).
   */
  type?: string;
  /** Some descendant matches this matcher (Detox `withDescendant`). */
  has?: Matcher;
  /** The element itself does NOT match this matcher (its own fields, `has` and `not`). */
  not?: Matcher;
  /** Restrict the search to descendants of the (single) element matched by this matcher. */
  within?: Matcher;
  /** Pick the n-th match (0-based, in render order) when several elements match. */
  index?: number;
}
