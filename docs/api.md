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
| `pinch(target, scale, { angle, speed })` | Two fingers move apart (`scale` > 1) or together (< 1) on the element, on a line at `angle` radians (0 = horizontal). See [Multi-finger gestures](#multi-finger-gestures) |
| `rotate(target, radians, { speed })` | Two fingers turn around the element's center (positive: clockwise on screen) |
| `multiTouch(fingers, { within })` | Any fingers along timed paths: `fingers[i]` is finger i's `{ x, y, t }` points (t in ms, non-decreasing); element coordinates with `within`, else window coordinates |

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

### Multi-finger gestures

`pinch`, `rotate` and `multiTouch` inject several real touches at once: iOS synthesized `UITouch`es in one
event, Android multi-pointer `MotionEvent`s, the web CDP `Input.dispatchTouchEvent` (touch viewports
only; a viewport without touch fails with `ACTION_NOT_SUPPORTED`). `js` mode cannot run them (gesture
recognizers need real touches).

Gesture recognizers start measuring only once they activate, after the fingers have moved a little, so a
plain "fingers twice as far apart" shows up in the app as less than 2. Quiesco moves the fingers by that
activation distance first, so the app's recognizer reports the requested scale / angle (measured within
about 2% and 1°). The defaults are the platforms' standard recognizers:

| | Pinch | Rotation |
|---|---|---|
| iOS (UIKit recognizers, also behind react-native-gesture-handler and `ScrollView` zooming) | 9 pt | 7° |
| Android (react-native-gesture-handler: 3 × touch slop) | 26 dp | 9° |
| Web (react-native-gesture-handler web: 3 × 15 px) | 46 px | 0° |

For another recognizer set `actions.gestureSlop: { pinch, rotation }` (logical units, radians; `0`: move
the fingers exactly by `scale` / `radians`). A pinch that does not fit on the screen in one go (e.g.
`pinch(t, 10)`) is done as several pinches, as a user would; the fingers go down on the element and stay in
the window. Tag scenarios that need several fingers so viewports without touch can skip them (the
example uses `@multi-touch` and runs the desktop viewport with `--tags 'not @multi-touch'`).

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

### App lifecycle (`this.app.device`)

```ts
// A new process with typed launch arguments and a deep link (a real cold start: getInitialURL sees it).
await this.app.device.relaunch({ args: { user: 'ann', retries: 3 }, url: 'myapp://todos/1' });
await this.app.device.relaunch({ clearData: true });              // app data deleted first
await this.app.device.relaunch({ reinstall: true, permissions: ['camera'] });
await this.app.device.sendToBackground();                         // Home button; the process keeps running
await this.app.device.bringToForeground();                        // same process, waits until active and idle
await this.app.device.terminate();
const png = await this.app.device.screenshot('avatar');           // one element; no argument: the screen
await this.app.device.screenshot({ fullPage: true }, { name: 'todos' }); // the whole list, stitched; saved + attached
await this.app.device.reversePort(3001);                          // Android: adb reverse; elsewhere a no-op
```

| Method | What it does |
|---|---|
| `relaunch({ args, url, clearData, reinstall, permissions })` | Terminate and start the app again — always a new process. Keeps the app's data unless `clearData` / `reinstall`. `args` (any JSON) are merged over the config's `launchArgs`; `url` opens the app with that deep link; `permissions` are granted before the launch besides the config's (after `clearData` / `reinstall` the config's are granted again). Resolves once the app has connected |
| `terminate()` | Stop the app. Until `relaunch()`, every element call fails at once with `APP_NOT_RUNNING` (no waiting) |
| `sendToBackground()` / `bringToForeground()` | Home screen and back without restarting. In between, element calls fail with `APP_IN_BACKGROUND`. Not on the web (`ACTION_NOT_SUPPORTED`) |
| `install()` / `uninstall()` | Install `binaryPath` / remove the app |
| `screenshot(target?, { full, name }?)` | PNG (`Buffer`). No target: the screen as shown (web: the browser viewport). An element: cut out of the screen (its part on the screen); `full: true`: all of it — a scroll view with its whole content, an element partly scrolled away together with the rest — scrolled and stitched. `{ fullPage: true }`: the whole content of the screen's main (largest) scroll view; `{ fullPage: 'list' }`: of that scroll view. See [Screenshots](#screenshots). `name`: also saved in the scenario's artifacts directory and attached to the report |
| `reversePort(port)` / `unreversePort(port)` | Make a host port reachable as `localhost:port` from an Android device; a no-op on the iOS simulator and the web |
| `openUrl(url)` / `pressBack()` | Same as `this.app.openUrl` / `this.app.pressBack` |
| `appState` | `'running'`, `'background'` or `'terminated'` — what the test did to the app |

Before each scenario Quiesco starts an app a previous scenario left terminated, and brings a
backgrounded one back, so scenarios stay independent.

#### Device state

```ts
await this.app.device.setOrientation('landscape');      // resolves once the app's window has turned
await this.app.device.setAppearance('dark');
await this.app.device.setFontScale(1.3);                 // iOS: nearest Dynamic Type size; returns the scale applied
await this.app.device.setLocale('ja-JP');                // iOS / web: the app is started again with it
await this.app.device.setLocation(35.68, 139.76);
await this.app.device.setPermission('location', 'revoke');
await this.app.device.setNetwork('offline');             // the app's requests fail; Quiesco stays connected
await this.app.device.clipboard.set('hello');            // what the app pastes
const copied = await this.app.device.clipboard.get();    // what the app copied
await this.app.device.setStatusBar({ time: '9:41', batteryLevel: 100 }); // for screenshots
```

| Method | What it does |
|---|---|
| `setOrientation('portrait' \| 'landscape')` | Rotates the app and waits until its window has the new shape. The app must not lock its orientation (app.json `"orientation": "default"`) |
| `setAppearance('light' \| 'dark')` | System color scheme; checked against what the app reports. The app must follow the system (`"userInterfaceStyle": "automatic"`) |
| `setFontScale(n)` | System text size (0.5–4); resolves with the scale applied. Android starts the app again (data kept). Not on the web |
| `setLocale(tag \| null)` | The app's language and region (BCP 47); `null` = device default. The app is started again with it (data kept). iOS needs the language in `CFBundleLocalizations` |
| `setLocation(lat, lon)` | Simulated GPS position (Android: emulators only) |
| `setPermission(name, 'grant' \| 'revoke' \| 'reset')` | Change a permission while the app runs. Android kills the app on a revoke: Quiesco starts it again (data kept) before resolving, so the app is back on its first screen. `'reset'` = not determined, as after a fresh install: the app's next request shows the system dialog again (Android: revoked, "don't ask again" cleared; iOS: `simctl privacy reset`; web: the browser asks). On iOS, notifications and the camera can only be reset by reinstalling the app: Quiesco reinstalls and starts it, **deleting its data** (needs `binaryPath`; a warning says so) |
| `setNetwork('offline' \| 'online')` | Offline: the app's new `fetch` / `XMLHttpRequest` / `WebSocket` connections fail as they do without a network (Quiesco's own connection keeps working; connections already open stay open). Android also turns Wi-Fi and mobile data off, the web reports `navigator.onLine === false`, so NetInfo sees it there; the iOS simulator has no network switch, NetInfo keeps reporting online. Lasts across relaunches |
| `clipboard.set(text)` / `clipboard.get()` | The device clipboard, written / read inside the app (iOS / Android need `@quiesco/native` ≥ Phase 6.6; iOS reads fall back to `simctl pbpaste`). Cleared before the next scenario when set |
| `setStatusBar({ time, batteryLevel, charging, wifiBars, cellularBars, dataNetwork })` / `resetStatusBar()` | Status bar for clean screenshots: `time` `'9:41'`, `batteryLevel` 0–100, `wifiBars` 0–3, `cellularBars` 0–4, `dataNetwork` `'wifi' \| '3g' \| '4g' \| 'lte' \| '5g' \| 'hide'`. Nothing to do on the web |

Every change is undone before the next scenario, and when the session ends: permissions go back to the
configured ones, the rest to what the device had (only what was changed is touched). A call that starts
the app again leaves it on its first screen. Detox's `setURLBlacklist` is
`this.app.sync.ignoreUrls.add()` here.

#### System integration

```ts
await this.app.device.biometrics.enroll();     // Face ID / Touch ID / a fingerprint is set up
await this.app.tap('login-with-face-id');      // the app calls LocalAuthentication.authenticateAsync()
await this.app.device.biometrics.match();      // a matching face / finger: the app's authentication succeeds
await this.app.device.shake();
await this.app.device.clearKeychain();         // iOS
await this.app.device.sendNotification({ title: 'New message', data: { chatId: '42' } });
await this.app.device.openNotification('New message'); // tap it (iOS: banner / Notification Center; Android: shade)

await this.app.tap('enable-notifications');           // the app asks for a permission
await this.app.device.system.allowPermission();        // the system dialog's allow button
await this.app.device.system.tap({ text: 'Cancel' });  // any system UI outside the app
```

| Method | What it does |
|---|---|
| `biometrics.enroll(enrolled = true)` | Enroll (or remove) a face / fingerprint. Android: Quiesco sets a screen-lock PIN (required for fingerprints) and goes through Settings' enrollment; the app is brought back to the front. Undone before the next scenario |
| `biometrics.match()` / `biometrics.fail()` | Present a matching / unknown face or finger to the authentication the app is showing. After `fail()` the system keeps its retry prompt up, as on a device: the app gets no result until the prompt is answered. Several failures in a row lock the sensor for a while (Android emulator: from about 0.5 s up to 30 s) |
| `shake()` | A device shake (iOS: Simulator's *Device > Shake*; Android emulator: accelerometer pushes), then waits for idle |
| `sendNotification({ title, body?, data? })` | iOS: a simulated remote push (`simctl push`, `data` next to `aps`); the app's push library gets it while the app is in front, and the system shows it only when the app may show notifications (they cannot be pre-granted on the simulator). Android: an emulator has no push service, so the notification is posted as the app (needs the `notifications` permission); tapping it opens the app with `data` as intent extras, and the push library's callbacks do not fire. Works while the app is in the background |
| `openNotification(title)` | Tap the notification: iOS its banner, or in Notification Center once the banner is gone; Android in the notification shade. Resolves when the app is in front and idle |
| `clearKeychain()` | iOS: resets the simulator's keychain (every app's). Android has no keychain: `ACTION_NOT_SUPPORTED`, use `relaunch({ clearData: true })` |
| `system.tap(query, { timeoutMs }?)` | Tap system UI outside the app (a permission dialog, the biometric prompt, a web page's JS dialog). `query`: `{ text }` (exact, typographic quotes ignored, or a RegExp) and / or `{ id }` (Android resource-id, or the part after `:id/`). Waits up to `timeoutMs` (10 s) for it to show up, then for the app to be idle |
| `system.expectVisible(query)` / `system.expectNotVisible(query)` | Wait until such system UI is (not) on screen; `ELEMENT_NOT_FOUND` / `ASSERTION_FAILED` list the texts seen |
| `system.allowPermission()` / `system.denyPermission()` | Answer the runtime permission dialog whatever the device language (Android: by its buttons' ids, also "while using the app" and "don't ask again"; iOS: by position, as iOS lays them out); resolves when the app is in front and idle |

None of these exist on the web (`ACTION_NOT_SUPPORTED`; tag such scenarios `@native`), except `system.tap` /
`expectVisible` / `expectNotVisible` for the page's JavaScript dialogs (below). On Android they need an emulator (its console fakes the
sensors). On iOS, system UI belongs to SpringBoard: Quiesco builds a small XCUITest runner the first time
it is needed (once per Xcode version, cached in `~/Library/Caches/quiesco/ios-runner`, about 10 s) and starts
it on the simulator (2–4 s, once per session). Alerts outlive the app: one left by a scenario is dismissed
(cancel / deny) before the next. To ask for a permission again, reset it first: `setPermission('notifications', 'reset')`.

While a permission dialog (another activity) is in front, Android pauses the app's JS timers; Quiesco's idle
wait notices that the app went to the background and returns, so the tap that opened the dialog completes.

**Web JavaScript dialogs.** `alert`, `confirm` and `prompt` stay open until the test answers them, as a user
would: they are system UI too. The dialog's message is a node with id `dialog.message`, its buttons are `OK`
(`dialog.accept`) and, for `confirm` / `prompt`, `Cancel` (`dialog.dismiss`); a prompt accepted gets its
default value.

```ts
await this.app.tap('clear-all');                                   // the page calls confirm('Delete all?')
await this.app.device.system.expectVisible({ text: 'Delete all?' });
await this.app.device.system.tap({ text: 'Cancel' });              // confirm() returns false; then waits for idle
```

While a dialog is open the page runs no script and takes no input, so the action that opened it returns as
soon as the dialog is up (without waiting for idle), and any other call on the app fails at once with
`DIALOG_OPEN` naming the dialog (answer it first); a screenshot too, the page does not paint. A dialog still
open when the scenario ends is dismissed before the next one, with a warning. `beforeunload` prompts are
always accepted (leaving or reloading the page is never held up).

### Screenshots

```ts
await this.app.device.screenshot();                                   // the screen
await this.app.device.screenshot('avatar');                           // an element (its part on the screen)
await this.app.device.screenshot('terms', { full: true });            // all of it, scrolled and stitched
await this.app.device.screenshot({ fullPage: true });                 // the main scroll view's whole content
await this.app.device.screenshot({ fullPage: 'todo-list' });          // that scroll view's
await this.app.webview('help').element({ css: '#chart' }).screenshot(); // an element of a WebView page
await this.app.device.screenshot(undefined, { name: 'home' });        // + artifacts/<run>/<scenario>/home.png, attached
```

A full-page screenshot is the same on every platform: Quiesco scrolls the scroll view to the top
(programmatically, as `scrollToEdge` does in js mode), takes a screenshot per screenful and stitches them —
everything above the scroll view (status bar, header) from the first one, the newly revealed strip of each
next one, what is below the scroll view (tab bar) from the last one — so fixed headers and footers appear
once. A virtualized list that renders more rows as it scrolls is followed to its end. Scroll indicators are
hidden meanwhile (native) and the scroll position is put back afterwards. Content that changes while it
scrolls (sticky section headers, animations) shows as it was when each screenful was taken.

### WebView (`this.app.webview()`)

Elements of a page shown in a WebView: react-native-webview on iOS / Android, an `<iframe>` on the web
(react-native-webview has no web implementation, so an app renders an iframe there, e.g. in a
`MyWebView.web.tsx`).

```ts
const help = this.app.webview('help');                  // the WebView by matcher (testID, ...); no argument: the only one on screen
await help.element({ css: '#name' }).type('Alice');
await help.element({ xpath: '//input[@name="name"]' }).replaceText('Bob');
await help.element({ text: '打招呼' }).tap();
await help.element({ id: 'result' }).expectText('你好，Bob');
await help.element({ text: /^Loading/ }).expectNotVisible();
const title = await help.runScript<string>('return document.title');   // a function body; `arguments`, promises awaited
await help.url(); await help.title();
```

| Method | What it does |
|---|---|
| `element({ css } \| { xpath } \| { id } \| { text }, index?)` | An element of the page. `text`: the element's text with whitespace collapsed, exactly, or a RegExp; the innermost matching element |
| `tap()` | A real tap (iOS / Android: a touch at the element's position on screen; web: Playwright input), after scrolling it into view. Fails at once with `MULTIPLE_MATCHES`, or with `ELEMENT_NOT_FOUND` when no visible, enabled match appears within the timeout |
| `type(text)` / `replaceText(text)` | Tap the field (it gets the focus, as from a user), then insert the text at the caret (`execCommand('insertText')`: `input` events like typing) / replace its value. No software keyboard input |
| `scrollIntoView()` | Scroll the page until the element is in view |
| `expectText(text \| RegExp)` | The single match's text (inputs: their value) |
| `expectExists()` / `expectNotExists()` / `expectVisible()` / `expectNotVisible()` | Visible = in the page's viewport (not scrolled away) and not hidden by CSS |
| `runScript(body, args?)` | Run a function body in the page and return its (JSON) value; a returned promise is awaited. A page exception fails with `APP_ERROR` |
| `url()` / `title()` | `location.href` / `document.title` |

Every call waits for the app to be idle and for the page to settle: loaded and no `fetch` / `XMLHttpRequest`
of the page running (counted by a script Quiesco adds to the page; timers of the page are not tracked —
assertions retry until their timeout anyway). Only the WebView's main frame: iframes inside the page and
shadow DOM are not reached. iOS / Android need `@quiesco/native` (scripts run through the native WebView,
no `onMessage` needed in the app); without it `ACTION_NOT_SUPPORTED`. `runScript` uses `new Function`, which
a page's Content-Security-Policy may forbid.

### Runtime synchronization (`this.app.sync`)

Change what Quiesco waits for, for the rest of the scenario — instead of switching synchronization off
altogether:

```ts
await this.app.sync.disableTracker('timer');            // e.g. a screen that polls every 200 ms
await this.app.sync.ignoreElements.add('poll-count');   // its text changes with every poll
await this.app.sync.ignoreUrls.add(/\/analytics/);      // a request that never finishes
await this.app.sync.disable();                          // all trackers off (Detox disableSynchronization)
await this.app.sync.enable();
```

`disableTracker` / `enableTracker` take `network`, `timer`, `react`, `idle-callback`, `frame-stable`,
`native`. `ignoreUrls` and `ignoreElements` add to / remove from the config's lists. The changes
survive relaunches and reconnects, and are undone before the next scenario. For a single call,
`{ sync: false }` still works.

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

// The launch arguments of this launch (config `launchArgs` + `app.device.relaunch({ args })`), with
// their JSON types. Synchronous, so it can be read at startup. `{}` in production and in builds
// without @quiesco/native on iOS / Android.
const { user } = quiesco.launchArgs() as { user?: string };
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
| `actions.gestureSlop` | per platform (see [Multi-finger gestures](#multi-finger-gestures)) | `{ pinch, rotation }`: how far fingers move before the app's recognizers activate |
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

Platform tags can sit on the feature, a `Rule`, the scenario or an `Examples` block; the innermost one decides.
In a feature tagged `@native`, an untagged scenario runs on iOS and Android, and a scenario tagged `@android`
runs on Android only. This differs from cucumber-js `--tags`, which matches inherited tags too.

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
| `APP_NOT_RUNNING` / `APP_IN_BACKGROUND` | The test terminated the app / sent it to the background (`this.app.device`); relaunch it / bring it back first |
| `DIALOG_OPEN` | Web: the page shows a JavaScript dialog (`data.message`); answer it with `app.device.system.tap({ text: 'OK' })` / `{ text: 'Cancel' }` first |

## Artifacts

Per scenario, under `artifacts/<date-time>-<platform>/<nnn>-<scenario>/`, and attached to the report:

| Artifact | When | What |
|---|---|---|
| Failure evidence | the scenario failed | `failure.png` — the screen with the elements of the failed call framed in red (an assertion's elements, an obscured target, several matches); `element-tree.json`; `idle-state.json` (what was busy) |
| Saved screenshots | `screenshot(…, { name })` | `<name>.png` |
| `video` | per policy | iOS `simctl io recordVideo` (MP4); Android `screenrecord` (MP4, a new segment every 3 minutes); web Playwright's screencast (WebM). Attached as a file path |
| `logs` | per policy | `device.log`: iOS the app process's unified log (`log stream`, info and above), Android logcat of the app's uid, web the page console and uncaught errors. The last 300 lines inline |
| `timeline` | per policy | every call on the app with its duration and how much of it was waiting for idle, failed calls with their error: `timeline.html` (inline) and `timeline.trace.json` (Chrome trace: `chrome://tracing`, ui.perfetto.dev) |

```ts
export default defineConfig({
  artifacts: { dir: 'artifacts', video: 'failing', logs: 'failing', timeline: 'failing' },
});
```

Policies: `none`, `failing` (recorded for every scenario, kept when it fails) or `all`. Defaults: video
`none` (recording costs a little on every scenario; turn it on in CI), logs and timeline `failing`.
`QUIESCO_ARTIFACTS=all` (or `failing`, `none`) sets all three for one run. Other runners use the same
through the session: `session.startScenario({ name })` before `beforeScenario`, then
`session.afterScenario({ failed })` returns the attachments and files.

## Using Quiesco without Cucumber

`@quiesco/core` does not depend on any test runner, so Jest, Vitest, Mocha or a plain script can drive
the app as well as Cucumber. Everything Cucumber steps do through `this.app` is `session.driver`; a
runner needs four calls:

```ts
import { createSession, loadConfig, resolvePlatform } from '@quiesco/core';

const { config } = await loadConfig();
const session = await createSession({ config, platform: resolvePlatform() }); // server, device, install, launch, connect
await session.startScenario({ name: 'logs in' });                           // artifacts: timeline, video
await session.beforeScenario({ tags: ['@smoke'] });                          // soft (or hard) reset
await session.driver.tap('login-button');                                     // the Driver
const { attachments, files } = await session.afterScenario({ failed });      // evidence + artifacts per policy
await session.dispose();
```

Map them onto the runner's lifecycle: `createSession` in a before-all hook (it boots the device and
launches the app, so give the hook a long timeout), `startScenario` + `beforeScenario` before each test,
`afterScenario` after it (on failure: the framed screenshot, element tree and idle state, plus video /
logs / timeline per [the artifacts policy](#artifacts)), `dispose` in an after-all hook.
`collectEvidence()` still returns the failure evidence alone. A complete Vitest file is in the
[README](../README.md#other-test-runners-jest-vitest).

Runs are serial: one session drives one device. `cucumber-js --parallel` is refused; with Vitest set
`fileParallelism: false`, with Jest pass `--runInBand`. `quiesco test` only starts `cucumber-js` — for
other runners set `QUIESCO_PLATFORM` (or pass the platform to `resolvePlatform`) and start the runner
yourself.
