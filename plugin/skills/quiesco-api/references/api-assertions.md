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

Holds when at least one matching element is [visible](./api-matchers.md#visibility).

```ts
await app.expectVisible('todo-list-screen');

// the banner shows at least 75% of its area
await app.expectVisible('promo-banner', { ratio: 0.75 });
```

| Option | Meaning |
|---|---|
| `ratio` | A number in (0, 1]: the element must show at least this fraction of its area. Out of range throws a `RangeError` |

### `expectNotVisible(target, options?)` {#expectnotvisible}

Holds when no matching element is visible: there is none, or it is hidden.

```ts
await app.tap('close-dialog');
await app.expectNotVisible('confirm-dialog');
```

### `expectExists(target, options?)` {#expectexists}

Holds when a matching element is in the element tree, visible or not.

```ts
// rendered further down the list, not yet scrolled to
await app.expectExists({ id: 'todo-row', index: 49 });
```

### `expectNotExists(target, options?)` {#expectnotexists}

Holds when no matching element is in the element tree.

```ts
await app.swipe({ id: 'todo-row', has: { text: 'Buy milk' } }, 'left');
await app.tap('delete');
await app.expectNotExists({ text: 'Buy milk' });
```

### `expectCount(target, n, options?)` {#expectcount}

Holds when exactly `n` elements match.

```ts
await app.type('new-todo', 'Walk the dog');
await app.pressKey('new-todo', 'enter');
await app.expectCount({ id: 'todo-row' }, 3);
```

## Content {#content}

### `expectText(target, text, options?)` {#expecttext}

Holds when exactly one element matches and its text equals `text`, or matches it when `text` is a
regular expression.

```ts
await app.expectText('todo-title', 'Buy milk');

await app.expectText('items-left', /^\d+ items? left$/);
```

### `expectValue(target, value, options?)` {#expectvalue}

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

A date / time picker's value is what it shows, in the device's local time: `"2031-12-24"` (mode `date`),
`"20:15"` (`time`), `"2031-12-24T20:15"` (`datetime`), with seconds when they are not 0. A `Date` matches
when those parts agree. See [date and time pickers](./api-value-controls.md#date-and-time-pickers).

### `expectLabel(target, text, options?)` {#expectlabel}

Holds when exactly one element matches and its accessibility label equals `text`, or matches it when
`text` is a regular expression.

```ts
await app.expectLabel('cart-button', 'Cart, 3 items');

await app.expectLabel('cart-button', /^Cart, \d+ items$/);
```

### `expectProp(target, prop, value, options?)` {#expectprop}

Holds when exactly one element matches and its prop `prop` has this JSON value. The host element's props
are looked at first, then those of its component (e.g. `disabled`, `value`).

```ts
await app.expectProp('new-todo', 'placeholder', 'What needs to be done?');

await app.expectProp('save', 'disabled', false);
```

## State {#state}

### `expectEnabled(target, options?)` {#expectenabled}

Holds when exactly one element matches and it is enabled.

```ts
await app.type('email', 'ann@example.com');
await app.type('password', 'secret');
await app.expectEnabled('sign-in');
```

### `expectDisabled(target, options?)` {#expectdisabled}

Holds when exactly one element matches and it is disabled.

```ts
// the form is empty
await app.expectDisabled('sign-in');
```

An element is disabled through `disabled`, `accessibilityState.disabled`, `aria-disabled` or
`editable={false}`, also when it inherits it from an ancestor.

### `expectChecked(target, options?)` {#expectchecked}

Holds when exactly one element matches and it is checked: a switch, checkbox or radio, or any element
with `accessibilityState.checked`.

```ts
await app.tap({ type: 'switch', label: 'Notifications' });
await app.expectChecked({ type: 'switch', label: 'Notifications' });
```

### `expectNotChecked(target, options?)` {#expectnotchecked}

Holds when exactly one element matches and it is unchecked.

```ts
await app.expectNotChecked({ type: 'checkbox', label: 'Remember me' });
```

An element without a checked state fails both `expectChecked` and `expectNotChecked`.

### `expectFocused(target, options?)` {#expectfocused}

Holds when exactly one element matches and it has the input focus.

```ts
await app.tap('new-todo');
await app.expectFocused('new-todo');
```

### `expectNotFocused(target, options?)` {#expectnotfocused}

Holds when exactly one element matches and it does not have the input focus.

```ts
await app.pressKey('new-todo', 'enter');
await app.dismissKeyboard();
await app.expectNotFocused('new-todo');
```

## Chained form {#chained-form}

### `expect(target)` {#expect}

The same assertions in a chained form, like Detox and Jest. Both forms do the same thing: they wait for
idle and retry until the assertion holds. Each method takes the [call options](./api.md#call-options) as its
last argument, and `.not` negates it.

```ts
await app.expect('save').toBeEnabled();
await app.expect({ type: 'switch', label: 'Wi-Fi' }).not.toBeChecked();

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
