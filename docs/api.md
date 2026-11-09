# API reference

- [Driver (`this.app`)](#driver-thisapp): actions, assertions, queries, backdoors
- [Matchers](#matchers)
- [In-app API (`@quiesco/agent`)](#in-app-api-quiescoagent)
- [Configuration (`quiesco.config.ts`)](#configuration)
- [Scenario tags](#scenario-tags)
- [Errors](#errors)
- [Using Quiesco without Cucumber](#using-quiesco-without-cucumber)

## Driver (`this.app`)

In step definitions `this.app` is the `Driver` of the current session (`@quiesco/core`). Every call is
`async`, waits for the app to be idle first (see [synchronization](sync.md)) and, for actions, again
after it. Nothing in a step needs to wait or sleep.

All calls take an optional last argument:

| Option | Meaning |
|---|---|
| `timeoutMs` | Timeout of this call (default `sync.timeoutMs`, 10 s) |
| `sync: false` | Do not wait for idle around this call (screens with endless animations) |
| `mode: 'native' \| 'js'` | Actions only: real input or calling the component's callbacks (default from `actions.mode`) |

### Actions

| Method | What it does |
|---|---|
| `tap(target, { point })` | Tap the element: its center, or `point` in its own coordinates (`{ x, y }` from its top-left corner) |
| `doubleTap(target)` / `multiTap(target, n)` | `n` taps in one gesture |
| `longPress(target, { durationMs, point })` | Press and hold (default 800 ms) |
| `type(target, text)` | Focus the input and enter `text` (native mode: through the IME, so any language works) |
| `replaceText(target, text)` | Replace the whole text at once |
| `clear(target)` | Clear a text input |
| `pressKey(target, 'enter' \| 'backspace')` | The return key (submits; a newline in a multi-line input) or backspace, sent to the field. The field only has to exist: the key reaches it even where a keyboard's return key would be out of reach |
| `scroll(target, direction, { distance, from })` | Scroll a scroll view (`down` reveals content below). `from`: start point normalized 0–1 in the element |
| `scrollTo(container, target)` | Scroll `container` until `target` is visible |
| `scrollToEdge(target, 'top' \| 'bottom' \| 'left' \| 'right')` | Scroll to an end; a virtualized list is followed while it grows (native mode: real flings) |
| `scrollToIndex(list, index, { viewPosition })` | Bring row `index` of a FlatList / FlashList into view, also without `getItemLayout`; `viewPosition` 0 = top, 0.5 = middle, 1 = bottom |
| `swipe(target, direction, { speed, distance, from })` | A swipe gesture (with inertia); `direction` is the finger's |
| `drag(target, to, { holdMs, speed })` | Press and hold the element (default 800 ms), move to the center of `to` (an element) or to `{ point }` (window coordinates), release |
| `tapAt({ x, y })` / `longPressAt({ x, y }, { durationMs })` | Touch a point of the screen (window coordinates), whatever is there |
| `pressBack()` | Android back button; browser back on the web; not available on iOS |
| `openUrl(url)` | Open a deep link (in the app on iOS, `am start` on Android, the address bar on the web) |
| `dismissKeyboard()` | Hide the software keyboard |
| `setValue(target, value)` | Set a value control: slider (number), switch / checkbox (boolean), picker (an item's value or label), segmented control (a segment's value or index), date / time picker or date input (`Date`). See [Value controls](#value-controls) |
| `adjustSlider(target, position)` | Drag a slider's thumb to `position` (0 = minimum, 1 = maximum) with a real finger / mouse; lands within one step of it |
| `accessibilityAction(target, name)` | Perform an action the element declares in `accessibilityActions`, as a screen reader does |

Coordinates are logical units (pt on iOS, dp on Android, CSS px on the web). `scrollToEdge` and
`scrollToIndex` take several steps; each step may wait up to the call timeout for the app to settle.

In `js` mode (callbacks instead of real input), a tap at a point presses the topmost element there, a
tap on a switch without `onPress` toggles it through `onValueChange`, `pressKey` calls
`onSubmitEditing` / `onKeyPress`, `scrollToEdge` sets the scroll offset, `from` is ignored, and `drag` is
not supported (it needs real touches).

### Value controls

`setValue` finds the control by the props of the component around the target (the element and a few
levels up; if there is none, the single control inside the element, e.g. a `View` carrying the testID
around a component that drops it):

| Control | Recognized by | `value` |
|---|---|---|
| `@react-native-community/slider` | `onValueChange` / `onSlidingComplete` with a numeric `value` or `minimumValue` / `maximumValue` | a number within the range and on a `step` |
| `Switch`, `expo-checkbox` | a boolean `value` and `onValueChange` | `true` / `false` |
| `@react-native-picker/picker` | `onValueChange` and `selectedValue` | an item's value (also as a string), or its label |
| `@react-native-segmented-control/segmented-control` | a `values` array and `onChange` / `onValueChange` | a segment's value, or its index |
| `@react-native-community/datetimepicker` | a `Date` `value` and `onChange` / `onValueChange` | a `Date` (checked against `minimumDate` / `maximumDate`) |
| DOM `<select>`, `<input type="date" / "time" / "datetime-local" / "month" / "week" / "range" / "number">`, checkbox | the element itself (web) | an option's value or label; a `Date` (written in local time) or the input's own string |

Anything else fails with `ACTION_NOT_SUPPORTED` naming the callbacks that were found. Setting the
current value sends no event, and a disabled control is left alone (as with a user's attempt).

How the value gets in, per mode:

| | `native` (iOS / Android) | web (real input) | `js` |
|---|---|---|---|
| Switch / checkbox | a real tap when the value must change | a click | `onChange` + `onValueChange` |
| Segmented control | a real tap on the segment | a click on the segment | `onChange` (native event) + `onValueChange` |
| Picker | iOS: the wheel is turned by a finger (slow drags that rest before lifting, read back and corrected); Android: callbacks (the dropdown / dialog is a separate window) | `<select>`: `selectOption` | `onValueChange(value, index)` |
| Date picker | iOS wheels (`display="spinner"`): every column is turned by a finger — which unit a column turns is found by turning it one row, so any locale and order works; compact / inline style and Android (a system dialog): callbacks | date inputs: `fill` | `onValueChange` / `onChange` with `{ type: 'set', nativeEvent: { timestamp, utcOffset } }` |
| Slider | callbacks (exact value; use `adjustSlider` for a real drag) | callbacks | `onSlidingStart`, `onValueChange`, `onSlidingComplete` |

Android's `DateTimePicker` renders no view (it opens a dialog), so after the app shows it, `setValue({ id })`
finds the component itself by its testID (or `{ type: 'DateTimePicker' }` by name); the app closes the
dialog when it handles the change, as it would for the user's choice. Only `id`, `type` and `index`
reach such components.

`adjustSlider` drags the thumb in `native` mode and reads the value back: the thumb follows the finger
less the touch slop, so it drags again (always one way, with a run-up) until the slider is within one
step (1% of a continuous slider's range) of the position. Web: a mouse drag of the thumb. `js`: the value
at that position, through the callbacks.

`accessibilityAction(target, name)` acts on the target or the nearest ancestor declaring
`accessibilityActions`; the target does not have to be on screen. `name` must be declared (otherwise the
error lists the declared ones). iOS: `increment` / `decrement` through `accessibilityIncrement` /
`accessibilityDecrement`, `magicTap` / `escape` through their perform methods, every other name through
the view's custom actions (VoiceOver's Actions rotor). Android: `performAccessibilityAction` with the id
React Native gave the action. Web (`accessibilityActions` do not reach the DOM) and `js`:
`onAccessibilityAction({ nativeEvent: { actionName } })`.

An action needs exactly one **visible** element: it waits until the target exists and is visible (or
fails with `ELEMENT_NOT_FOUND`, saying whether it is missing or hidden) and fails at once with
`MULTIPLE_MATCHES` when several elements match. In `native` mode the touch must also be able to reach the
element: if a dialog or another window covers it, the action fails with `ELEMENT_OBSCURED` naming what is
on top. A software keyboard covering the target is dismissed first.

### Assertions

Assertions retry until they hold or the timeout runs out (`ASSERTION_FAILED` with expected / actual).

| Method | Holds when |
|---|---|
| `expectVisible(target, { ratio })` | at least one matching element is visible; with `ratio` (0–1], it shows at least that fraction of its area |
| `expectNotVisible(target)` | no matching element is visible (absent or hidden) |
| `expectExists(target)` / `expectNotExists(target)` | an element is / is not in the tree, visible or not |
| `expectText(target, text \| RegExp)` | exactly one match and its text equals / matches |
| `expectValue(target, value \| RegExp)` | exactly one match and its value equals / matches: input text, switch state, slider / picker value or `accessibilityValue` |
| `expectLabel(target, text \| RegExp)` | exactly one match and its accessibility label equals / matches |
| `expectFocused(target)` / `expectNotFocused(target)` | exactly one match and it has / does not have the input focus |
| `expectEnabled(target)` / `expectDisabled(target)` | exactly one match and it is enabled / disabled (`disabled`, `accessibilityState.disabled`, `aria-disabled`, `editable={false}`, also inherited from an ancestor) |
| `expectChecked(target)` / `expectNotChecked(target)` | exactly one match and it is checked / unchecked (switch, checkbox, radio or `accessibilityState.checked`); an element without a checked state fails both |
| `expectProp(target, prop, value)` | exactly one match and the prop has this JSON value (host props first, then its component's, e.g. `disabled`, `value`) |
| `expectCount(target, n)` | exactly `n` elements match |

The same assertions in a chained, Detox / Jest-like form (both forms call the same implementation):

```ts
await this.app.expect('save').toBeEnabled();
await this.app.expect({ type: 'switch', label: 'Wi-Fi' }).not.toBeChecked();
await this.app.expect('banner').toBeVisible({ ratio: 0.75 });     // Detox: toBeVisible(75)
await this.app.expect({ id: 'title' }).not.toHaveValue('');
```

`toBeVisible({ ratio })`, `toExist()`, `toBeFocused()`, `toBeEnabled()`, `toBeDisabled()`, `toBeChecked()`,
`toHaveText()`, `toHaveValue()`, `toHaveLabel()`, `toHaveProp()`, `toHaveCount()` and `toHaveId()`, each
with `.not`. A negated single-element assertion (`not.toHaveText`, ...) still needs exactly one match.

### Queries, sync and state

| Method | Returns |
|---|---|
| `query(target)` | Summaries of the matching elements (no waiting) |
| `attributes(target)` | The summary of the single matching element, after waiting for it to exist (Detox `getAttributes`); `MULTIPLE_MATCHES` for several |
| `getTree()` | The element tree as JSON, with semantic types (also attached to failed scenarios) |
| `waitForIdle({ timeoutMs })` | Waits until idle; resolves with the time it took |
| `getIdleState()` | Every tracker's state — what is busy right now |
| `backdoor(name, ...args)` | Calls a backdoor registered in the app; arguments and result are JSON |
| `reset()` | Soft reset (Quiesco does this before every scenario) |

An element summary has `type` (host component), `semanticType`, `testID`, `text`, `label`, `role`,
`value`, `checked`, `enabled`, `focused`, `rect`, `visible`, `visibleRatio` and the serializable `props`.

## Matchers

A plain string is a **testID**: `tap('add-todo')`. An object combines conditions:

```ts
{ id: 'todo-item', index: 0 }                  // first of several, in render order
{ id: /^todo-\d+$/ }                            // testID by regular expression
{ text: 'Save' }                                // displayed text, exact
{ text: /saved \d+ items/i }                    // or a regular expression
{ label: 'Close' }                              // accessibilityLabel / aria-label
{ role: 'button', text: 'Save' }                // accessibilityRole / role
{ type: 'switch' }                              // semantic type, the same on every platform (below)
{ type: 'TodoCard' }                            // or a host type ('RCTView', 'div') or a component's displayName
{ type: 'button', has: { text: 'Buy milk' } }   // with a matching descendant (Detox withDescendant)
{ type: 'button', not: { id: 'cancel' } }       // excluding elements that match
{ text: 'Delete', within: 'todo-item-3' }       // inside another element (Detox withAncestor)
```

`text` matches the deepest element whose own text matches (a button and its label do not both match).
On the web `testID` is rendered as `data-testid`; matchers are the same on every platform, and `index`
follows render order on every platform (Detox's `atIndex` order differs between iOS and Android).

### Semantic types

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

A widget made of several hosts counts once. For example, react-native-web's `Switch` is a `<div>`
around an `<input role="switch">`: `{ type: 'switch' }` matches the outer element, which also reports
the input's checked state, value, focus, disabled state and label.

### Visibility

An element is visible when neither it nor an ancestor is hidden by style (`display: none`,
`opacity: 0`) and part of it is on screen: inside the window **and** inside every ancestor that clips its
content (scroll views, `overflow` other than `visible`). An element scrolled out of a scroll view is not
visible even if that position is inside the window. `visibleRatio` is the visible fraction of its area.
Being covered by another element is not part of visibility; actions check it separately
(`ELEMENT_OBSCURED`).

## In-app API (`@quiesco/agent`)

The app imports the agent on the first line of its entry file and wraps its root in `<QuiescoRoot>`
(`npx quiesco init` sets both up). In builds without `EXPO_PUBLIC_QUIESCO=1`, `withQuiesco()` in
`metro.config.js` replaces the package with a no-op stub, so this code can stay in the app.

```ts
import { QuiescoRoot, quiesco } from '@quiesco/agent';

// Test-only setup without the UI. Arguments and the result must be JSON.
quiesco.backdoor('loginAs', async (email: string) => {
  await authStore.setSession(await testApi.createSession(email));
});

// Run during every soft reset, after storage is cleared and before the app is remounted.
quiesco.onReset(async () => {
  queryClient.clear();
});

// Storage cleared on soft reset in addition to the built-in ones
// (AsyncStorage's default store on iOS / Android; localStorage, sessionStorage, IndexedDB on the web).
quiesco.registerStorage({ name: 'mmkv', clear: () => storage.clearAll() });
```

Register backdoors and hooks in a module that is only imported in e2e builds
(`if (process.env.EXPO_PUBLIC_QUIESCO === '1') require('./e2e')`), so the test code is not even in
production bundles. Each registration returns a function that removes it.

## Configuration

`quiesco.config.ts` in the project root (`.mts`, `.js` and `.mjs` also work):

```ts
import { defineConfig } from '@quiesco/core';

export default defineConfig({
  apps: {
    ios: { bundleId: 'com.example.app', binaryPath: 'ios/build/…/App.app', devClient: { metroUrl: 'http://localhost:8081' } },
    android: { package: 'com.example.app', binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk', devClient: { scheme: 'myapp' } },
    web: { distDir: 'dist' },                       // or { url: 'http://localhost:8081' }
  },
  devices: {
    ios: { device: 'iPhone 17', os: '27.0' },
    android: { avd: 'Pixel_9_API_37' },
    web: { browser: 'chromium', viewport: { width: 390, height: 844, hasTouch: true, isMobile: true } },
  },
  permissions: ['location'],
  sync: { timeoutMs: 10_000, ignoreUrls: [/\/analytics\//] },
});
```

| Key | Default | Meaning |
|---|---|---|
| `apps.ios.bundleId` / `binaryPath` / `devClient.metroUrl` | | App to install (`.app` for the simulator) and launch; `devClient`: launch the Expo dev client with this Metro |
| `apps.android.package` / `binaryPath` / `activity` / `devClient` / `reversePorts` | `.MainActivity` | APK to install and launch; `devClient: { scheme, metroUrl }`; `reversePorts`: host ports the app calls on `localhost` (`adb reverse`) |
| `apps.web.distDir` / `url` / `path` | `/` | An export (static: served by Quiesco; `web.output: "server"`: hosted with `npx expo serve`), or a running server |
| `devices.ios.device` / `os` / `udid` | the booted simulator | Which simulator; booted if needed |
| `devices.ios.disablePasswordAutoFill` | `true` | Keep iOS's "Save Password?" sheet from covering the app |
| `devices.android.avd` / `serial` | a running device | Which emulator / device; the AVD is booted (cold) if not running |
| `devices.*.shutdown` | `false` | Shut down a device Quiesco booted when the run ends |
| `devices.web.browser` / `headless` / `viewport` | `chromium`, headless | Browser and screen size (nothing is built in) |
| `permissions` | `[]` | Granted before launch: `camera`, `microphone`, `location`, `notifications`, `contacts`, `photos`, `calendar` ([per platform](platforms.md#permissions)) |
| `sync.timeoutMs` | `10000` | How long a call waits for idle |
| `sync.timerThresholdMs` | `1500` | Timers up to this delay keep the app busy |
| `sync.countIntervals` | `false` | Whether `setInterval` keeps the app busy |
| `sync.stableFrames` | `2` | Frames the element tree must stay the same |
| `sync.ignoreUrls` | `[]` | Requests that never keep the app busy (strings match as substrings) |
| `sync.trackers` | all on | e.g. `{ 'frame-stable': false }` |
| `sync.ignoreElements` | `[]` | Matchers of elements (with their subtrees) left out of the frame-stable check, e.g. a decorative animation: `['logo-glow']` |
| `actions.mode` | `native` if the app has `@quiesco/native`, else `js` | Real input or callbacks |
| `reset.default` | `soft` | `hard` relaunches the app before every scenario |
| `server.port` / `server.host` | `7357` / all interfaces | The host's WebSocket server |
| `connectTimeoutMs` | `30000` | How long to wait for the app after launch |
| `logLevel` | `warn` | App console messages forwarded to the test output (`off` to disable) |
| `tags` | see below | Rename the scenario tags |
| `appErrors.ignore` / `ignoreDefaults` | `[]` / `true` | App errors that only log a warning instead of failing the step |

The platform comes from `QUIESCO_PLATFORM` (`ios`, `android`, `web`) or `quiesco test --platform`.
The config file is plain TypeScript, so values can come from the environment.

## Scenario tags

| Tag | Effect |
|---|---|
| `@ios`, `@android`, `@web` | Run the scenario only on these platforms (several tags: any of them) |
| `@native` | iOS and Android only |
| `@hard-reset` | Relaunch the app before this scenario instead of the soft reset |

Untagged scenarios run everywhere. Rename them with `tags: { web: '@browser' }`.

## Errors

Failures are `QuiescoError`s with `errorName`, a message that says what to do, and structured `data`.

| Error | Meaning |
|---|---|
| `ELEMENT_NOT_FOUND` | No visible element matched within the timeout (missing, or present but hidden) |
| `MULTIPLE_MATCHES` | The action's matcher matched several elements; `data.matches` lists them |
| `ELEMENT_OBSCURED` | A real touch would land on something else; `data.obscuredBy` (and the native hit chain on iOS) |
| `SYNC_TIMEOUT` | The app did not become idle; lists every busy tracker ([details](sync.md#when-the-app-never-becomes-idle)) |
| `ASSERTION_FAILED` | `data.expected`, `data.actual` and the elements seen |
| `ACTION_NOT_SUPPORTED` | e.g. `pressBack` on iOS, or `native` mode without the native module (with a hint) |
| `BACKDOOR_NOT_REGISTERED` / `BACKDOOR_FAILED` / `NOT_SERIALIZABLE` | Backdoor problems; the first lists the registered names, the last the path of the bad value |
| `APP_ERROR` | An uncaught error in the app failed the current step (see `appErrors` to ignore known ones) |
| `RESET_FAILED` | Which soft-reset step failed (`storage:<name>`, `onReset#<n>`, `remount`) |
| `PROTOCOL_MISMATCH` / `SESSION_MISMATCH` | Agent and host versions differ / an app from another run connected |
| `CONNECT_TIMEOUT` | The app did not connect after launch (the message has a checklist) |
| `AGENT_TIMEOUT` | The app stopped answering — usually its JS thread is blocked |
| `AGENT_DISCONNECTED`, `DEVICE_ERROR`, `CONFIG_ERROR` | Lost connection, device tooling failure (adb / simctl / Playwright), invalid config |

When a scenario fails, `@quiesco/cucumber` attaches a screenshot, the element tree and the tracker
states to the report.

## Using Quiesco without Cucumber

`@quiesco/core` does not depend on any test runner, so Jest, Vitest, Mocha or a plain script can drive
the app as well as Cucumber. Everything Cucumber steps do through `this.app` is `session.driver`; a
runner needs four calls:

```ts
import { createSession, loadConfig, resolvePlatform } from '@quiesco/core';

const { config } = await loadConfig();
const session = await createSession({ config, platform: resolvePlatform() }); // server, device, install, launch, connect
await session.beforeScenario({ tags: ['@smoke'] });                          // soft (or hard) reset
await session.driver.tap('login-button');                                     // the Driver
const evidence = await session.collectEvidence();                            // screenshot, tree, idle state (on failure)
await session.dispose();
```

Map them onto the runner's lifecycle: `createSession` in a before-all hook (it boots the device and
launches the app, so give the hook a long timeout), `beforeScenario` before each test, `collectEvidence`
when a test fails, `dispose` in an after-all hook. A complete Vitest file is in the
[README](../README.md#other-test-runners-jest-vitest).

Runs are serial: one session drives one device. `cucumber-js --parallel` is refused; with Vitest set
`fileParallelism: false`, with Jest pass `--runInBand`. `quiesco test` only starts `cucumber-js` — for
other runners set `QUIESCO_PLATFORM` (or pass the platform to `resolvePlatform`) and start the runner
yourself.
