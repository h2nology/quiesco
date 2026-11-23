<!-- Generated from docs/api-matchers.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Matchers

How a target finds elements: by test id, text, label, role, type, position, descendants and ancestors.
Most methods take a **target**: the element to act on or check. A plain string is a `testID`; an object
combines conditions, and an element matches when all of them hold. Matchers are the same on iOS, Android
and the web.

```ts
// a string is a testID
await app.tap('add-todo');

// an object combines conditions
await app.tap({ role: 'button', text: 'Save' });
```

On the web, `testID` is rendered as `data-testid`; matchers do not change.

## Matcher fields {#fields}

### `id` {#id}

The `testID`: an exact string or a regular expression. `'save'` is short for `{ id: 'save' }`.

```ts
await app.tap({ id: 'save' });

// every todo row: todo-1, todo-2, …
await app.expectCount({ id: /^todo-\d+$/ }, 3);
```

### `text` {#text}

The displayed text: an exact string or a regular expression. It matches the **deepest** element whose own
text matches, so a button and the label inside it do not both match.

```ts
await app.tap({ text: 'Sign in' });

await app.expectVisible({ text: /saved \d+ items/i });
```

### `label` {#label}

The accessibility label: `accessibilityLabel` on iOS / Android, `aria-label` on the web. An exact string
or a regular expression.

```ts
// an icon-only close button
await app.tap({ label: 'Close' });
```

### `role` {#role}

The accessibility role: `accessibilityRole` on iOS / Android, `role` on the web.

```ts
await app.tap({ role: 'button', text: 'Save' });
```

### `type` {#type}

What kind of element it is. Either a [semantic type](#semantic-types), the same on every platform, or a
host type (`'RCTView'`, `'div'`), or the `displayName` of a component that renders the element.

```ts
// semantic type: works on every platform
await app.tap({ type: 'switch' });

// a component of the app
await app.expectCount({ type: 'TodoCard' }, 2);
```

### `has` {#has}

The element has a descendant that matches this matcher (Detox `withDescendant`).

```ts
// the row that contains "Buy milk"
await app.swipe({ id: 'todo-row', has: { text: 'Buy milk' } }, 'left');

await app.tap({ type: 'button', has: { text: 'Buy milk' } });
```

### `not` {#not}

Leaves out elements that match this matcher.

```ts
// the only button that is not Cancel
await app.tap({ type: 'button', not: { id: 'cancel' } });
```

### `within` {#within}

The element is inside the single element matched by this matcher (Detox `withAncestor`).

```ts
// the Delete button of one todo
await app.tap({ text: 'Delete', within: 'todo-item-3' });
```

### `index` {#index}

The n-th match, counting from `0`, in render order. The order is the same on every platform (Detox's
`atIndex` order differs between iOS and Android).

```ts
// the first of several todo rows
await app.expectText({ id: 'todo-title', index: 0 }, 'Buy milk');
```

## Semantic types {#semantic-types}

`type` accepts these platform-independent kinds. They come from the accessibility role first, then from
the host component, so they also work in release builds where component names are minified.

| `type` | iOS / Android host (React Native 0.88) | Web (react-native-web) | Role |
|---|---|---|---|
| `button` | `Pressable`, `Touchable*`, `Button`, or a view whose component has `onPress` | `<button>`, same components | `button`, `togglebutton`, `imagebutton` |
| `link` | — | `<a>` | `link` |
| `header` | — | `<h1>`–`<h6>` | `header`, `heading` |
| `text` | `RCTText`, `RCTVirtualText`, `RCTSelectableText` | `Text` | `text` |
| `input` | `RCTSinglelineTextInputView`, `RCTMultilineTextInputView`, `AndroidTextInput` | `<input>`, `<textarea>` | `textbox`, `searchbox`, `search` |
| `image` | `RCTImageView`, `ExpoImage` | `<img>`, `Image` | `image`, `img` |
| `switch` | `Switch` (iOS), `AndroidSwitch` | `Switch` | `switch` |
| `checkbox` / `radio` | — | `<input type="checkbox">` / `"radio"` | `checkbox` / `radio` |
| `slider` | `RNCSlider` | `<input type="range">` | `adjustable`, `slider` |
| `picker` | `RNCPicker`, `RNCAndroidDialogPicker`, `RNCAndroidDropdownPicker`, `RNDateTimePicker` | `<select>` | `combobox`, `spinbutton` |
| `progress` | `ActivityIndicatorView`, `AndroidProgressBar` | `<progress>`, `ActivityIndicator` | `progressbar` |
| `scroll` | `RCTScrollView`, `AndroidHorizontalScrollView` | `ScrollView` | — |
| `list` | the scroll view of a `FlatList` / `SectionList` / `FlashList` (its component has `renderItem`) | same | `list` |

```ts
// the Wi-Fi switch on the settings screen
await app.tap({ type: 'switch', label: 'Wi-Fi' });
await app.expectChecked({ type: 'switch', label: 'Wi-Fi' });
```

A widget made of several hosts counts once. For example, react-native-web's `Switch` is a `<div>` around
an `<input role="switch">`: `{ type: 'switch' }` matches the outer element, which also reports the input's
checked state, value, focus, disabled state and label.

## Visibility {#visibility}

Actions and `expectVisible` need a **visible** element. An element is visible when:

- neither it nor an ancestor is hidden by style (`display: none`, `opacity: 0`), and
- part of it is on screen: inside the window **and** inside every ancestor that clips its content (scroll
  views, `overflow` other than `visible`).

An element scrolled out of a scroll view is not visible, even if that position is inside the window. An
element's `visibleRatio` ([element summary](./api-queries.md#element-summary)) is the visible fraction of its
area.

An element on a screen that is not on top is not visible either: on iOS / Android a native stack keeps the
screens below in place, covered by the later one (unless it is presented as a transparent modal), and
inactive tab screens are detached.

Being covered by another element is not part of visibility. Actions check that separately and fail with
`ELEMENT_OBSCURED` ([finding elements](./api.md#finding-elements)).

```ts
// the last row is below the fold: not visible until scrolled to
await app.expectExists({ id: 'todo-row', index: 49 });
await app.expectNotVisible({ id: 'todo-row', index: 49 });

await app.scrollTo('todo-list', { id: 'todo-row', index: 49 });
await app.expectVisible({ id: 'todo-row', index: 49 });
```

When an element is found but not visible, the failure says why: on a screen that is not on top, hidden by
an ancestor's style, outside the window, clipped by a scroll view, or no size. In Expo Router apps,
failures end with the current route: `(current route: /students/new)`.
