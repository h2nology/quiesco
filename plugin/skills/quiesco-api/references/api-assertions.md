<!-- Generated from docs/api-assertions.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Assertions

Check what is on screen: visibility, text, value, label, enabled, checked, focus, props and counts, retried until they hold.
An assertion checks the screen and **retries until it holds** or the call's timeout runs out (see
[call options](./api.md#call-options)). Then it fails with `ASSERTION_FAILED`, giving the expected and the
actual value. So a test never has to wait for the app before checking it.

```ts
await app.tap('add-todo');
// retried until the new row is there
await app.expectText({ id: 'todo-title', index: 0 }, 'Buy milk');
```

Every assertion resolves with the [summaries](./api-queries.md#element-summary) of the matching elements. Most
assertions about one element (text, value, label, focus, enabled, checked, props) need **exactly one**
match; the ones that need it say so below. Each assertion also has a [chained form](#expect),
`app.expect(target).toBe…()`.

## Visibility and presence {#visibility-and-presence}

### `expectVisible(target, options?)` {#expectvisible}

```ts
expectVisible(
  target: MatcherInput,
  options?: VisibleOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`VisibleOptions`](./api-types.md#visibleoptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when at least one matching element is [visible](./api-matchers.md#visibility).

```ts
await app.expectVisible('todo-list-screen');

// the banner shows at least 75% of its area
await app.expectVisible('promo-banner', { ratio: 0.75 });
```

| Option | Default | Meaning |
|---|---|---|
| `ratio` | — | A number in (0, 1]: the element must show at least this fraction of its area. Out of range throws a `RangeError` |
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectNotVisible(target, options?)` {#expectnotvisible}

```ts
expectNotVisible(
  target: MatcherInput,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when no matching element is visible: there is none, or it is hidden.

```ts
await app.tap('close-dialog');
await app.expectNotVisible('confirm-dialog');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectExists(target, options?)` {#expectexists}

```ts
expectExists(
  target: MatcherInput,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when a matching element is in the element tree, visible or not.

```ts
// rendered further down the list, not yet scrolled to
await app.expectExists({ id: 'todo-row', index: 49 });
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectNotExists(target, options?)` {#expectnotexists}

```ts
expectNotExists(
  target: MatcherInput,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when no matching element is in the element tree.

```ts
await app.swipe({ id: 'todo-row', has: { text: 'Buy milk' } }, Direction.left);
await app.tap('delete');
await app.expectNotExists({ text: 'Buy milk' });
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectCount(target, n, options?)` {#expectcount}

```ts
expectCount(
  target: MatcherInput,
  n: number,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when exactly `n` elements match.

```ts
await app.type('new-todo', 'Walk the dog');
await app.pressKey('new-todo', KeyName.enter);
await app.expectCount({ id: 'todo-row' }, 3);
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

## Content {#content}

### `expectText(target, text, options?)` {#expecttext}

```ts
expectText(
  target: MatcherInput,
  text: TextQuery,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`TextQuery`](./api-types.md#textquery) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when exactly one element matches and its text equals `text`, or matches it when `text` is a
regular expression.

```ts
await app.expectText('todo-title', 'Buy milk');

await app.expectText('items-left', /^\d+ items? left$/);
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectValue(target, value, options?)` {#expectvalue}

```ts
expectValue(
  target: MatcherInput,
  value: JsonValue | RegExp | Date,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`JsonValue`](./api-types.md#jsonvalue) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when exactly one element matches and its value equals `value`, or matches it when `value` is a
regular expression. The value is the text of an input, the state of a switch, the value of a slider or
picker, or the `accessibilityValue`.

```ts
await app.expectValue('email', 'ann@example.com');
await app.expectValue('dark-mode-switch', true);
await app.expectValue('volume-slider', 0.5);

// a date picker: compares what it shows, in the device's local time
await app.expectValue('due-date', new Date(2031, 11, 24));
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

A date / time picker's value is what it shows, in the device's local time: `"2031-12-24"` (mode `date`),
`"20:15"` (`time`), `"2031-12-24T20:15"` (`datetime`), with seconds when they are not 0. A `Date` matches
when those parts agree. See [date and time pickers](./api-value-controls.md#date-and-time-pickers).

### `expectLabel(target, text, options?)` {#expectlabel}

```ts
expectLabel(
  target: MatcherInput,
  text: TextQuery,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`TextQuery`](./api-types.md#textquery) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when exactly one element matches and its accessibility label equals `text`, or matches it when
`text` is a regular expression.

```ts
await app.expectLabel('cart-button', 'Cart, 3 items');

await app.expectLabel('cart-button', /^Cart, \d+ items$/);
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectProp(target, prop, value, options?)` {#expectprop}

```ts
expectProp(
  target: MatcherInput,
  prop: string,
  value: JsonValue,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`JsonValue`](./api-types.md#jsonvalue) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when exactly one element matches and its prop `prop` has this JSON value. The host element's props
are looked at first, then those of its component (e.g. `disabled`, `value`).

```ts
await app.expectProp('new-todo', 'placeholder', 'What needs to be done?');

await app.expectProp('save', 'disabled', false);
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

## State {#state}

### `expectEnabled(target, options?)` {#expectenabled}

```ts
expectEnabled(
  target: MatcherInput,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when exactly one element matches and it is enabled.

```ts
await app.type('email', 'ann@example.com');
await app.type('password', 'secret');
await app.expectEnabled('sign-in');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectDisabled(target, options?)` {#expectdisabled}

```ts
expectDisabled(
  target: MatcherInput,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when exactly one element matches and it is disabled.

```ts
// the form is empty
await app.expectDisabled('sign-in');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

An element is disabled through `disabled`, `accessibilityState.disabled`, `aria-disabled` or
`editable={false}`, also when it inherits it from an ancestor.

### `expectChecked(target, options?)` {#expectchecked}

```ts
expectChecked(
  target: MatcherInput,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when exactly one element matches and it is checked: a switch, checkbox or radio, or any element
with `accessibilityState.checked`.

```ts
await app.tap({ type: SemanticType.switch, label: 'Notifications' });
await app.expectChecked({ type: SemanticType.switch, label: 'Notifications' });
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectNotChecked(target, options?)` {#expectnotchecked}

```ts
expectNotChecked(
  target: MatcherInput,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when exactly one element matches and it is unchecked.

```ts
await app.expectNotChecked({ type: SemanticType.checkbox, label: 'Remember me' });
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

An element without a checked state fails both `expectChecked` and `expectNotChecked`.

### `expectFocused(target, options?)` {#expectfocused}

```ts
expectFocused(
  target: MatcherInput,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when exactly one element matches and it has the input focus.

```ts
await app.tap('new-todo');
await app.expectFocused('new-todo');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

### `expectNotFocused(target, options?)` {#expectnotfocused}

```ts
expectNotFocused(
  target: MatcherInput,
  options?: CallOptions,
): Promise<ElementSummary[]>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`CallOptions`](./api-types.md#calloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Holds when exactly one element matches and it does not have the input focus.

```ts
await app.pressKey('new-todo', KeyName.enter);
await app.dismissKeyboard();
await app.expectNotFocused('new-todo');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to retry until the assertion holds |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |

## Chained form {#chained-form}

### `expect(target)` {#expect}

```ts
expect(target: MatcherInput): ElementExpectation
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`ElementExpectation`](./api-assertions.md#expect)

The same assertions in a chained form, like Detox and Jest. Both forms do the same thing: they wait for
idle and retry until the assertion holds. Each method takes the [call options](./api.md#call-options) as its
last argument, and `.not` negates it.

```ts
await app.expect('save').toBeEnabled();
await app.expect({ type: SemanticType.switch, label: 'Wi-Fi' }).not.toBeChecked();

// Detox: toBeVisible(75)
await app.expect('promo-banner').toBeVisible({ ratio: 0.75 });

await app.expect({ id: 'todo-title', index: 0 }).not.toHaveValue('');
```

| Chained | Same as |
|---|---|
| `toBeVisible({ ratio })` | `expectVisible` (`.not`: `expectNotVisible`) |
| `toExist()` | `expectExists` (`.not`: `expectNotExists`) |
| `toBeFocused()` | `expectFocused` (`.not`: `expectNotFocused`) |
| `toBeEnabled()` | `expectEnabled` (`.not`: `expectDisabled`) |
| `toBeDisabled()` | `expectDisabled` (`.not`: `expectEnabled`) |
| `toBeChecked()` | `expectChecked` (`.not`: `expectNotChecked`) |
| `toHaveText(text)` | `expectText` |
| `toHaveValue(value)` | `expectValue`, without the `Date` form |
| `toHaveLabel(text)` | `expectLabel` |
| `toHaveProp(prop, value)` | `expectProp` |
| `toHaveCount(n)` | `expectCount` |
| `toHaveId(id)` | A matching element has this `testID` (a string or a regular expression) |

A negated assertion about one element (`not.toHaveText`, `not.toHaveValue`, …) still needs exactly one
match: it fails when there is none.
