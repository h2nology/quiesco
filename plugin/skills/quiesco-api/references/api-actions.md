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

```ts
tap(
  target: MatcherInput,
  options?: TapOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`TapOptions`](./api-types.md#tapoptions) · [`ElementSummary`](./api-types.md#elementsummary)

Taps the center of the element. An element partly cut off by a scroll view or an `overflow` ancestor is
tapped at the center of its visible part.

```ts
await app.tap('save');

// a point inside the element, from its top-left corner
await app.tap('map', { point: { x: 40, y: 120 } });
```

| Option | Default | Meaning |
|---|---|---|
| `point` | the center | `{ x, y }` in the element's own coordinates, instead of its center |
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `doubleTap(target, options?)` {#doubletap}

```ts
doubleTap(
  target: MatcherInput,
  options?: ActionOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`ActionOptions`](./api-types.md#actionoptions) · [`ElementSummary`](./api-types.md#elementsummary)

Two taps in one gesture.

```ts
await app.doubleTap('photo');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `multiTap(target, count, options?)` {#multitap}

```ts
multiTap(
  target: MatcherInput,
  count: number,
  options?: ActionOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`ActionOptions`](./api-types.md#actionoptions) · [`ElementSummary`](./api-types.md#elementsummary)

`count` taps in one gesture.

```ts
// triple-tap to open the hidden debug menu
await app.multiTap('version-label', 3);
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `longPress(target, options?)` {#longpress}

```ts
longPress(
  target: MatcherInput,
  options?: LongPressOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`LongPressOptions`](./api-types.md#longpressoptions) · [`ElementSummary`](./api-types.md#elementsummary)

Presses and holds the element.

```ts
await app.longPress('message');

await app.longPress('message', { durationMs: 1500, point: { x: 10, y: 10 } });
```

| Option | Default | Meaning |
|---|---|---|
| `durationMs` | `800` | How long to hold |
| `point` | the center | `{ x, y }` in the element's own coordinates |
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `tapAt(point, options?)` {#tapat}

```ts
tapAt(point: Point, options?: ActionOptions): Promise<void>
```

Types: [`Point`](./api-types.md#point) · [`ActionOptions`](./api-types.md#actionoptions)

Taps a point of the screen (window coordinates), whatever is there.

```ts
// close a bottom sheet by tapping above it
await app.tapAt({ x: 200, y: 100 });
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `longPressAt(point, options?)` {#longpressat}

```ts
longPressAt(point: Point, options?: LongPressAtOptions): Promise<void>
```

Types: [`Point`](./api-types.md#point) · [`LongPressAtOptions`](./api-types.md#longpressatoptions)

Presses and holds a point of the screen (window coordinates).

```ts
await app.longPressAt({ x: 200, y: 400 }, { durationMs: 1000 });
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

## Text input {#text-input}

### `type(target, text, options?)` {#type}

```ts
type(
  target: MatcherInput,
  text: string,
  options?: TypeOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`TypeOptions`](./api-types.md#typeoptions) · [`ElementSummary`](./api-types.md#elementsummary)

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
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `replaceText(target, text, options?)` {#replacetext}

```ts
replaceText(
  target: MatcherInput,
  text: string,
  options?: ActionOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`ActionOptions`](./api-types.md#actionoptions) · [`ElementSummary`](./api-types.md#elementsummary)

Replaces the whole text of the input at once.

```ts
await app.replaceText('email', 'bob@example.com');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `clear(target, options?)` {#clear}

```ts
clear(
  target: MatcherInput,
  options?: ActionOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`ActionOptions`](./api-types.md#actionoptions) · [`ElementSummary`](./api-types.md#elementsummary)

Empties the input.

```ts
await app.clear('search');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `pressKey(target, key, options?)` {#presskey}

```ts
pressKey(
  target: MatcherInput,
  key: KeyName,
  options?: ActionOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`KeyName`](./api-constants.md#list) · [`ActionOptions`](./api-types.md#actionoptions) · [`ElementSummary`](./api-types.md#elementsummary)

Sends the return key (`'enter'`) or `'backspace'` to the field. `'enter'` submits a single-line input and
adds a newline in a multi-line one. The field only has to exist: the key reaches it even where the
keyboard's return key would be out of reach.

```ts
await app.type('search', 'milk');
await app.pressKey('search', KeyName.enter);

await app.pressKey('code-input', KeyName.backspace);
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `dismissKeyboard(options?)` {#dismisskeyboard}

```ts
dismissKeyboard(options?: ActionOptions): Promise<void>
```

Types: [`ActionOptions`](./api-types.md#actionoptions)

Hides the software keyboard.

```ts
await app.type('notes', 'Call before noon');
await app.dismissKeyboard();
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

## Scrolling {#scrolling}

### `scroll(target, direction, options?)` {#scroll}

```ts
scroll(
  target: MatcherInput,
  direction: Direction,
  options?: ScrollOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`Direction`](./api-constants.md#list) · [`ScrollOptions`](./api-types.md#scrolloptions) · [`ElementSummary`](./api-types.md#elementsummary)

Scrolls a scroll view. `'down'` reveals the content below. In `native` mode a finger drags and slows down
to a stop, so the content moves by about `distance` without a fling (less the system's touch slop: about
10 pt on iOS, 7% on Android).

```ts
await app.scroll('feed', Direction.down);

await app.scroll('feed', Direction.down, { distance: 300, from: { x: 0.5, y: 0.8 } });
```

| Option | Default | Meaning |
|---|---|---|
| `distance` | — | How far to scroll, in logical units |
| `from` | — | Where the finger starts, normalized 0–1 within the element |
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `scrollTo(container, target, options?)` {#scrollto}

```ts
scrollTo(
  container: MatcherInput,
  target: MatcherInput,
  options?: ActionOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`ActionOptions`](./api-types.md#actionoptions) · [`ElementSummary`](./api-types.md#elementsummary)

Scrolls `container` until the center of `target` is visible (where a tap goes): down, then up; right,
then left in a horizontal list. Each step moves less than one screenful, so nothing is skipped. At an end
of the content, a target whose center stays cut off is returned as it is.

```ts
await app.scrollTo('settings-list', 'sign-out');
await app.tap('sign-out');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `scrollToEdge(target, edge, options?)` {#scrolltoedge}

```ts
scrollToEdge(
  target: MatcherInput,
  edge: Edge,
  options?: ActionOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`Edge`](./api-constants.md#list) · [`ActionOptions`](./api-types.md#actionoptions) · [`ElementSummary`](./api-types.md#elementsummary)

Scrolls to the `'top'`, `'bottom'`, `'left'` or `'right'` end. A virtualized list that renders more rows as
it scrolls is followed while it grows (in `native` mode with real flings).

```ts
await app.scrollToEdge('feed', Edge.bottom);
await app.expectVisible({ text: 'No more posts' });
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `scrollToIndex(list, index, options?)` {#scrolltoindex}

```ts
scrollToIndex(
  list: MatcherInput,
  index: number,
  options?: ScrollToIndexOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`ScrollToIndexOptions`](./api-types.md#scrolltoindexoptions) · [`ElementSummary`](./api-types.md#elementsummary)

Brings row `index` of a `FlatList` / `FlashList` into view, also without `getItemLayout`.

```ts
await app.scrollToIndex('contacts', 120);

// row 120 in the middle of the list
await app.scrollToIndex('contacts', 120, { viewPosition: 0.5 });
```

| Option | Default | Meaning |
|---|---|---|
| `viewPosition` | `0` | Where the row ends up: `0` top, `0.5` middle, `1` bottom |
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

`scrollTo`, `scrollToEdge` and `scrollToIndex` take several steps (at most 60); each step may wait up to the
call's timeout for the app to settle.

## Gestures {#gestures}

### `swipe(target, direction, options?)` {#swipe}

```ts
swipe(
  target: MatcherInput,
  direction: Direction,
  options?: SwipeOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`Direction`](./api-constants.md#list) · [`SwipeOptions`](./api-types.md#swipeoptions) · [`ElementSummary`](./api-types.md#elementsummary)

A swipe with inertia. `direction` is the direction the finger moves.

```ts
// reveal the row's delete button
await app.swipe({ id: 'todo-row', index: 0 }, Direction.left);

await app.swipe('carousel', Direction.left, { speed: Speed.fast, distance: 250 });
```

| Option | Default | Meaning |
|---|---|---|
| `speed` | `'normal'` | `'slow'`, `'normal'` or `'fast'` |
| `distance` | | How far the finger moves |
| `from` | | Where the finger starts, normalized 0–1 within the element |
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `drag(target, to, options?)` {#drag}

```ts
drag(
  target: MatcherInput,
  to: MatcherInput | { point: Point },
  options?: DragOptions,
): Promise<ElementSummary | undefined>
```

Types: [`MatcherInput`](./api-types.md#matcherinput) · [`Point`](./api-types.md#point) · [`DragOptions`](./api-types.md#dragoptions) · [`ElementSummary`](./api-types.md#elementsummary)

Presses and holds the element, moves it to the center of `to` (an element), or to `{ point }` (window
coordinates), and releases. It needs real touches: not available in `js` mode.

```ts
// reorder: drag the first row onto the third
await app.drag({ id: 'todo-row', index: 0 }, { id: 'todo-row', index: 2 });

await app.drag('pin', { point: { x: 160, y: 420 } }, { holdMs: 300, speed: Speed.slow });
```

| Option | Default | Meaning |
|---|---|---|
| `holdMs` | `800` | How long to hold before moving |
| `speed` | `'normal'` | `'slow'`, `'normal'` or `'fast'` |
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the target and for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

Pinch, rotate and other gestures with several fingers are on [multi-finger gestures](./api-gestures.md).

## Navigation {#navigation}

### `goBack(options?)` {#goback}

```ts
goBack(options?: ActionOptions): Promise<void>
```

Types: [`ActionOptions`](./api-types.md#actionoptions)

Goes back to the previous screen the way a user does on each platform: the Android back button (after
closing the keyboard), the browser's back, the navigation bar's back button on iOS, else the iOS edge
swipe. In an Expo Router app it fails when the route did not change.

```ts
await app.tap({ text: 'Buy milk' });
await app.goBack();
await app.expectVisible('todo-list-screen');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `pressBack(options?)` {#pressback}

```ts
pressBack(options?: ActionOptions): Promise<void>
```

Types: [`ActionOptions`](./api-types.md#actionoptions)

The Android back button, or the browser's back on the web. Not available on iOS (`ACTION_NOT_SUPPORTED`):
use `goBack()` for a test that runs everywhere.

```ts
// Android: close the bottom sheet with the back button
await app.pressBack();
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

### `openUrl(url, options?)` {#openurl}

```ts
openUrl(url: string, options?: ActionOptions): Promise<void>
```

Types: [`ActionOptions`](./api-types.md#actionoptions)

Opens a deep link: in the app on iOS, with `am start` on Android, in the address bar on the web. While the
app is in the background (`app.device.sendToBackground()`), it opens the link from outside the app as
another app would; on iOS it answers the system's "Open in …?" question. Resolves when the app is in front
and idle.

```ts
await app.openUrl('myapp://todos/42');
await app.expectText('detail-title', 'Buy milk');
```

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long to wait for the app to be idle |
| `sync` | `true` | `false`: do not wait for the app to be idle around this call ([call options](./api.md#call-options)) |
| `mode` | `actions.mode` | `'native'`: real touches and keyboard input; `'js'`: call the component's callbacks |

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
