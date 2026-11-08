/**
 * Chained assertions in the style of Detox / Jest (`await app.expect('save').not.toBeEnabled()`).
 * Every method maps to the same agent assertion as the matching `app.expectXxx()` call: it waits for
 * idle, then retries until the assertion holds or the timeout runs out.
 */
import type { AssertionSpec, ElementSummary, JsonValue, Matcher } from '@quiesco/protocol';

import type { CallOptions } from './options.js';
import type { MatcherInput, TextQuery } from './matcher.js';
import { toMatcher, toTextMatch } from './matcher.js';

export interface VisibleOptions extends CallOptions {
  /** Minimum visible fraction of the element's area, 0–1 (Detox's `toBeVisible(75)` is `{ ratio: 0.75 }`). */
  ratio?: number;
}

type Assert = (spec: AssertionSpec, opts?: CallOptions) => Promise<ElementSummary[]>;

export class ElementExpectation {
  constructor(
    private readonly target: MatcherInput,
    private readonly run: Assert,
    private readonly negated = false,
  ) {}

  /** The negated expectation: `app.expect(t).not.toBeVisible()`. */
  get not(): ElementExpectation {
    return new ElementExpectation(this.target, this.run, !this.negated);
  }

  toBeVisible(opts: VisibleOptions = {}): Promise<ElementSummary[]> {
    const { ratio, ...call } = opts;
    const spec: Extract<AssertionSpec, { type: 'visible' | 'notVisible' }> = { type: this.negated ? 'notVisible' : 'visible', matcher: this.m() };
    if (ratio !== undefined) spec.ratio = checkRatio(ratio);
    return this.run(spec, call);
  }
  toExist(opts?: CallOptions): Promise<ElementSummary[]> {
    return this.run({ type: this.negated ? 'notExists' : 'exists', matcher: this.m() }, opts);
  }
  toBeFocused(opts?: CallOptions): Promise<ElementSummary[]> {
    return this.run({ type: this.negated ? 'notFocused' : 'focused', matcher: this.m() }, opts);
  }
  toBeEnabled(opts?: CallOptions): Promise<ElementSummary[]> {
    return this.run({ type: this.negated ? 'disabled' : 'enabled', matcher: this.m() }, opts);
  }
  toBeDisabled(opts?: CallOptions): Promise<ElementSummary[]> {
    return this.run({ type: this.negated ? 'enabled' : 'disabled', matcher: this.m() }, opts);
  }
  /** Switch / checkbox / radio, or any element with `accessibilityState.checked` (Detox `toHaveToggleValue`). */
  toBeChecked(opts?: CallOptions): Promise<ElementSummary[]> {
    return this.run({ type: this.negated ? 'notChecked' : 'checked', matcher: this.m() }, opts);
  }
  toHaveText(text: TextQuery, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.run(this.neg({ type: 'text', matcher: this.m(), expected: toTextMatch(text) }), opts);
  }
  toHaveLabel(label: TextQuery, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.run(this.neg({ type: 'label', matcher: this.m(), expected: toTextMatch(label) }), opts);
  }
  /** Input text, switch state, slider / picker value or accessibilityValue (Detox `toHaveValue` / `toHaveSliderPosition`). */
  toHaveValue(value: JsonValue | RegExp, opts?: CallOptions): Promise<ElementSummary[]> {
    const expected = value instanceof RegExp ? toTextMatch(value) : value;
    return this.run(this.neg({ type: 'value', matcher: this.m(), expected }), opts);
  }
  toHaveProp(prop: string, value: JsonValue, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.run(this.neg({ type: 'prop', matcher: this.m(), prop, expected: value }), opts);
  }
  toHaveCount(n: number, opts?: CallOptions): Promise<ElementSummary[]> {
    return this.run(this.neg({ type: 'count', matcher: this.m(), expected: n }), opts);
  }
  /** Some matching element has this testID (Detox `toHaveId`). */
  toHaveId(id: TextQuery, opts?: CallOptions): Promise<ElementSummary[]> {
    const matcher: Matcher = { ...this.m(), id: toTextMatch(id) };
    return this.run({ type: this.negated ? 'notExists' : 'exists', matcher }, opts);
  }

  private m(): Matcher {
    return toMatcher(this.target);
  }

  private neg<S extends AssertionSpec & { not?: boolean }>(spec: S): S {
    return this.negated ? { ...spec, not: true } : spec;
  }
}

export function checkRatio(ratio: number): number {
  if (!(ratio > 0 && ratio <= 1)) throw new RangeError(`ratio must be in (0, 1], got ${ratio}`);
  return ratio;
}
