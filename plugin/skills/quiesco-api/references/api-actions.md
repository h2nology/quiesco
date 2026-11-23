<!-- Generated from docs/api-actions.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Actions

Tap, type, scroll, swipe and drag like a user, go back, and open deep links.
Actions do what a user does. In `native` mode (the default when the app has `@quiesco/native`) they are
real touches and keyboard input; in `js` mode they call the component's callbacks instead (see
[call options](./api.md#call-options)). Every action waits for the app to be idle before and after it, and
needs exactly one visible target ([finding elements](./api.md#finding-elements)).

Coordinates are logical units: points on iOS, dp on Android, CSS pixels on the web.

## Tapping {#tapping}

### `tap(target, options?)` {#tap}

Taps the center of the element. An element partly cut off by a scroll view or an `overflow` ancestor is
tapped at the center of its visible part.

```ts
await app.tap('save');

// a point inside the element, from its top-left corner
await app.tap('map', { point: { x: 40, y: 120 } });
```

| Option | Meaning |
|---|---|
| `point` | `{ x, y }` in the element's own coordinates, instead of its center |

### `doubleTap(target, options?)` {#doubletap}

Two taps in one gesture.

```ts
await app.doubleTap('photo');
```

### `multiTap(target, count, options?)` {#multitap}

`count` taps in one gesture.

```ts
// triple-tap to open the hidden debug menu
await app.multiTap('version-label', 3);
```

### `longPress(target, options?)` {#longpress}

Presses and holds the element.

```ts
await app.longPress('message');

await app.longPress('message', { durationMs: 1500, point: { x: 10, y: 10 } });
```

| Option | Default | Meaning |
|---|---|---|
| `durationMs` | `800` | How long to hold |
| `point` | the center | `{ x, y }` in the element's own coordinates |

### `tapAt(point, options?)` {#tapat}

Taps a point of the screen (window coordinates), whatever is there.

```ts
// close a bottom sheet by tapping above it
await app.tapAt({ x: 200, y: 100 });
```

### `longPressAt(point, options?)` {#longpressat}

Presses and holds a point of the screen (window coordinates).

```ts
await app.longPressAt({ x: 200, y: 400 }, { durationMs: 1000 });
```

## Text input {#text-input}

### `type(target, text, options?)` {#type}

Focuses the input and enters `text` after what is already there. In `native` mode the text goes through
the system's input method, so any language works. On iOS and Android the whole text arrives at once; on the
web one key per character.

```ts
await app.type('email', 'ann@example.com');

// one character at a time: for debounced search, input masks, onKeyPress
await app.type('search', 'milk', { perCharacter: true });
```

| Option | Default | Meaning |
|---|---|---|
| `perCharacter` | `false` | Type one character at a time, so the app sees every keystroke. The call waits for idle at the end |
| `intervalMs` | `80` | With `perCharacter`: the time between two characters |

### `replaceText(target, text, options?)` {#replacetext}

Replaces the whole text of the input at once.

```ts
await app.replaceText('email', 'bob@example.com');
```

### `clear(target, options?)` {#clear}

Empties the input.

```ts
await app.clear('search');
```

### `pressKey(target, key, options?)` {#presskey}

Sends the return key (`'enter'`) or `'backspace'` to the field. `'enter'` submits a single-line input and
adds a newline in a multi-line one. The field only has to exist: the key reaches it even where the
keyboard's return key would be out of reach.

```ts
await app.type('search', 'milk');
await app.pressKey('search', 'enter');

await app.pressKey('code-input', 'backspace');
```

### `dismissKeyboard(options?)` {#dismisskeyboard}

Hides the software keyboard.

```ts
await app.type('notes', 'Call before noon');
await app.dismissKeyboard();
```

## Scrolling {#scrolling}

### `scroll(target, direction, options?)` {#scroll}

Scrolls a scroll view. `'down'` reveals the content below. In `native` mode a finger drags and slows down
to a stop, so the content moves by about `distance` without a fling (less the system's touch slop: about
10 pt on iOS, 7% on Android).

```ts
await app.scroll('feed', 'down');

await app.scroll('feed', 'down', { distance: 300, from: { x: 0.5, y: 0.8 } });
```

| Option | Meaning |
|---|---|
| `distance` | How far to scroll, in logical units |
| `from` | Where the finger starts, normalized 0–1 within the element |

### `scrollTo(container, target, options?)` {#scrollto}

Scrolls `container` until the center of `target` is visible (where a tap goes): down, then up; right,
then left in a horizontal list. Each step moves less than one screenful, so nothing is skipped. At an end
of the content, a target whose center stays cut off is returned as it is.

```ts
await app.scrollTo('settings-list', 'sign-out');
await app.tap('sign-out');
```

### `scrollToEdge(target, edge, options?)` {#scrolltoedge}

Scrolls to the `'top'`, `'bottom'`, `'left'` or `'right'` end. A virtualized list that renders more rows as
it scrolls is followed while it grows (in `native` mode with real flings).

```ts
await app.scrollToEdge('feed', 'bottom');
await app.expectVisible({ text: 'No more posts' });
```

### `scrollToIndex(list, index, options?)` {#scrolltoindex}

Brings row `index` of a `FlatList` / `FlashList` into view, also without `getItemLayout`.

```ts
await app.scrollToIndex('contacts', 120);

// row 120 in the middle of the list
await app.scrollToIndex('contacts', 120, { viewPosition: 0.5 });
```

| Option | Default | Meaning |
|---|---|---|
| `viewPosition` | `0` | Where the row ends up: `0` top, `0.5` middle, `1` bottom |

`scrollTo`, `scrollToEdge` and `scrollToIndex` take several steps (at most 60); each step may wait up to the
call's timeout for the app to settle.

## Gestures {#gestures}

### `swipe(target, direction, options?)` {#swipe}

A swipe with inertia. `direction` is the direction the finger moves.

```ts
// reveal the row's delete button
await app.swipe({ id: 'todo-row', index: 0 }, 'left');

await app.swipe('carousel', 'left', { speed: 'fast', distance: 250 });
```

| Option | Default | Meaning |
|---|---|---|
| `speed` | `'normal'` | `'slow'`, `'normal'` or `'fast'` |
| `distance` | | How far the finger moves |
| `from` | | Where the finger starts, normalized 0–1 within the element |

### `drag(target, to, options?)` {#drag}

Presses and holds the element, moves it to the center of `to` (an element), or to `{ point }` (window
coordinates), and releases. It needs real touches: not available in `js` mode.

```ts
// reorder: drag the first row onto the third
await app.drag({ id: 'todo-row', index: 0 }, { id: 'todo-row', index: 2 });

await app.drag('pin', { point: { x: 160, y: 420 } }, { holdMs: 300, speed: 'slow' });
```

| Option | Default | Meaning |
|---|---|---|
| `holdMs` | `800` | How long to hold before moving |
| `speed` | `'normal'` | `'slow'`, `'normal'` or `'fast'` |

Pinch, rotate and other gestures with several fingers are on [multi-finger gestures](./api-gestures.md).

## Navigation {#navigation}

### `goBack(options?)` {#goback}

Goes back to the previous screen the way a user does on each platform: the Android back button (after
closing the keyboard), the browser's back, the navigation bar's back button on iOS, else the iOS edge
swipe. In an Expo Router app it fails when the route did not change.

```ts
await app.tap({ text: 'Buy milk' });
await app.goBack();
await app.expectVisible('todo-list-screen');
```

### `pressBack(options?)` {#pressback}

The Android back button, or the browser's back on the web. Not available on iOS (`ACTION_NOT_SUPPORTED`):
use `goBack()` for a test that runs everywhere.

```ts
// Android: close the bottom sheet with the back button
await app.pressBack();
```

### `openUrl(url, options?)` {#openurl}

Opens a deep link: in the app on iOS, with `am start` on Android, in the address bar on the web. While the
app is in the background (`app.device.sendToBackground()`), it opens the link from outside the app as
another app would; on iOS it answers the system's "Open in …?" question. Resolves when the app is in front
and idle.

```ts
await app.openUrl('myapp://todos/42');
await app.expectText('detail-title', 'Buy milk');
```

## Other inputs {#other-inputs}

Controls that hold a value — switches, sliders, pickers, date pickers — are set with `setValue` and
`adjustSlider`, and `accessibilityAction` performs a screen reader's action: see
[value controls](./api-value-controls.md).

## In `js` mode {#js-mode}

When an action calls callbacks instead of touching the screen:

- a tap at a point presses the topmost element there;
- a tap on a switch without `onPress` toggles it through `onValueChange`;
- `pressKey` calls `onSubmitEditing` / `onKeyPress`;
- `scrollToEdge` sets the scroll offset;
- `from` is ignored;
- `drag` is not supported, since it needs real touches.
