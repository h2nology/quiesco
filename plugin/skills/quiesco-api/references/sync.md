<!-- Generated from docs/sync.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Synchronization

Why tests need no sleeps: what idle means, what keeps the app busy, and what to do when it never becomes idle.
Quiesco waits until the app is **idle** before and after every call. A test never needs `sleep` or
`waitFor`:

```ts
// waits for the request, the navigation and the next screen's render
await app.tap('save-todo');

// runs on the settled screen
await app.expectVisible('todo-list-screen');
```

## How it works {#how-it-works}

### Step 1: Wait, then act

Before a call, Quiesco waits until the app is idle. Then it taps, types or reads the screen.

### Step 2: The app reacts

The call starts work in the app: requests, timers, renders, animations.

### Step 3: Wait again

Quiesco waits until every [tracker](#trackers) is idle, twice in a row one macrotask apart, so a timer
that starts a request in the same tick is not missed. Then the call returns.

A call that is still waiting after `sync.timeoutMs` (10 s) fails with `SYNC_TIMEOUT`
([below](#when-the-app-never-becomes-idle)).

## Trackers {#trackers}

The agent in the app decides what "idle" means with these trackers. The app is idle when none is busy.

| Tracker | Busy while |
|---|---|
| `network` | a `fetch` or `XMLHttpRequest` is in flight, or a `WebSocket` / `EventSource` is connecting |
| `timer` | a `setTimeout` of at most 1.5 s is pending |
| `react` | React has a render or an effect still to run |
| `idle-callback` | a `requestIdleCallback` is pending |
| `native` (iOS only) | a screen transition or the keyboard is animating |
| `frame-stable` | the screen changed during the last 2 frames: animations on the UI thread |
| `native-module` (opt in) | a native module call has not finished, for at most 2 s ([details](#native-module-calls)) |

To turn one off:

```ts
sync: { trackers: { 'frame-stable': false } }
```

**network:**

- A `fetch` counts until the response arrives. Reading the body (`json()`, `text()`, …) right after
  keeps it busy until the body is in.
- `expo/fetch` is tracked too. A `fetch` built on XHR (React Native) counts once.
- A `WebSocket` / `EventSource` counts only until it opens, fails or closes. Open connections never
  count, nor does the agent's own connection.
- `sync.ignoreUrls` leaves out long polling, SSE and analytics.

**timer:**

- Only timers up to `sync.timerThresholdMs` (1.5 s) count: a 30 s session timeout does not block.
- `setInterval` counts only with `sync.countIntervals: true`.

**react:**

- The tracker reads React's own bookkeeping through the React DevTools hook: pending lanes, scheduled
  callbacks and tasks in React's scheduler. Nothing in the app needs to change.
- The agent has to install that hook before React Native's renderer loads. `withQuiesco()` in
  `metro.config.js` takes care of it.

**native (iOS):**

- Reported by `@quiesco/native`: UIKit work that JavaScript cannot see, such as navigation and modal
  transitions.
- The keyboard counts from UIKit's `keyboardWill…` notification to the matching `keyboardDid…`, at
  most the animation plus 0.5 s. iOS sometimes posts `keyboardDidShow` seconds late; the device log
  then has `[Quiesco] keyboard: no Did notification …`.

**frame-stable:**

- Compares the element tree (type, testID, text, rounded position and size) frame by frame. Busy when
  it changed in the last `sync.stableFrames` (2) frames.
- The fallback for animations that run on the UI thread (Reanimated, native-driver `Animated`), which
  the other trackers cannot see.
- It samples only while a call waits.

## Why was a call slow, or too early? {#timeline}

Every call's entry in `timeline.html` shows its wait for idle:

- **Slow call**: what the wait ended on, per tracker, e.g. `network: GET https://api.example.com/items (240ms)`.
- **Call returned too early**: its last checks, e.g. `+272ms busy: native-module | +276ms idle | +277ms idle (confirmed)`,
  and the native module calls that started or settled meanwhile. The time is the device clock, to line up
  with the device log.

A call that failed with `SYNC_TIMEOUT` has this record too, and so does each step of a `scrollTo`.

## When the app never becomes idle {#when-the-app-never-becomes-idle}

The call fails with `SYNC_TIMEOUT` and lists what was busy:

```
App did not become idle within the 10000ms timeout. Busy:
  - network: GET https://api.example.com/todos (10012ms)
  - timer: setTimeout(poll, 1000ms), fires in 420ms
  - frame-stable: element tree changing: stable for 1/2 frames (580 frames sampled in 9960ms)
    last change: first difference at node 12: Text "Loading 41%" … → Text "Loading 42%" …
```

Look up the busy tracker:

| Busy | Usual cause | Fix |
|---|---|---|
| `network` | a request that never ends: long polling, a stalled backend | add the URL to `sync.ignoreUrls`, or fix the backend / mock |
| `timer` | a short timer re-armed forever: polling, a self-rescheduling toast | `{ sync: false }` for that step, `this.app.sync.disableTracker('timer')`, or stop the loop in e2e builds |
| `frame-stable` | an endless animation: spinner, shimmer, decorative glow | give the element a testID and list it in `sync.ignoreElements` |
| `react` | a render loop: a state update in an effect without a guard | a real bug: fix it |

**Reading the report:**

- A tracker that was busy until shortly before the timeout but idle at that instant is listed too:
  `frame-stable (idle at the timeout, busy 12ms before it): …`. A loop of "timer → render → a few
  quiet frames" is idle part of the time, and the timeout can land there.
- `frame-stable` names the first element that changed, and `recent changes` lists the latest changes.
  When one element keeps changing back and forth, the report names it.
- Very few `frames sampled` for the time waited means the UI thread is starved (an overloaded
  emulator), not animating.
- `idle-state.json` shows `frame-stable` idle after a timeout, because it samples only while a call
  waits. Its `lastWait` keeps what it reported when the wait ended.

**A list that never settles:**

A `FlatList` / `VirtualizedList` without `getItemLayout` and with rows of slightly different heights
can keep adding and removing the item at the edge of its render window after a scroll: the report
shows an element added and removed each time. A longer `timeoutMs` does not help; `getItemLayout` or
fixed row heights usually stop it.

**Other fixes:**

- **timer**: lowering `sync.timerThresholdMs` below the loop's delay works too, but for every timer
  that short in the whole app.
- **frame-stable**: when the moving element is not decoration, call the step with `{ sync: false }`
  and assert what you need afterwards, or disable the animation in e2e builds.
- **network**: a `MOCK_STALL`-style switch in your mock server reproduces a stalled backend on purpose.

> **Note:**
>
>   `AGENT_TIMEOUT` is different: the agent did not answer at all, usually because a long synchronous task
>   blocks the JS thread.

## Skipping sync for one call {#skipping-sync-for-one-call}

```ts
// do not wait before / after
await this.app.tap('start-spinner', { sync: false });

// assert while it spins
await this.app.expectVisible('spinner', { sync: false });
```

## Native module calls {#native-module-calls}

By default, a pending native module call (AsyncStorage, a picker, …) does not keep the app busy. So an
action can return too early:

```ts
// fetch: tracked
await api.login(email, password);

// native module promise: not tracked by default
await AsyncStorage.setItem(TOKEN_KEY, token);

// the next screen mounts and fetches in an effect
router.replace('/');
```

`tap('login-submit')` can return while `setItem` is pending, before the next screen has started. Two fixes:

- Wait for what the next step needs: `await app.expectVisible('item-row-1')`.
- Or track native module calls: wrap them in the e2e build, and restart Metro.

```js
module.exports = withQuiesco(getDefaultConfig(__dirname), { nativeModules: true });
```

`EXPO_PUBLIC_QUIESCO_NATIVE_MODULES=1` when starting Metro does the same. The `native-module` tracker is
then on. Its settings:

```ts
sync: {
  // a pending call counts for at most this long
  nativeCallThresholdMs: 2000,

  // "Module.method"; strings match as substrings
  ignoreNativeCalls: ['ExpoLocation.watch'],

  // off in a build that wraps native modules
  // trackers: { 'native-module': false },
}
```

**Calls that never count:**

Some calls wait for the user and stay pending until the test answers them. They never count:

- permission requests: Expo modules and `PermissionsAndroid` (`*.request…Permission(s)(Async)`)
- date / time pickers: `RNCDatePicker.open`, `RNCTimePicker.open`
- `ExpoLocalAuthentication.authenticateAsync`
- share sheets: `ShareModule.share`, `ExpoSharing.shareAsync`
- `ExpoWebBrowser.openBrowserAsync` / `openAuthSessionAsync`
- image and document pickers
- alerts and action sheets: `AlertManager.alertWithArgs`, `DialogManagerAndroid.showAlert`,
  `ActionSheetManager.show…ActionSheetWithOptions`
- native-driver animations (`NativeAnimatedModule`)

`ignoreNativeCalls` adds to this list; `defaultIgnoreNativeCalls: false` counts these calls too. Any
other call stops counting after `nativeCallThresholdMs`. The timeline names it
(`native-module: Module.method() 1990ms`), to add to `ignoreNativeCalls`.

An event subscription (`addListener(eventName, listener)`, `add…Listener` / `remove…Listener(s)`)
counts only when it returns a promise, whatever `defaultIgnoreNativeCalls` says.

**What is not wrapped:**

- Modules taken during React Native's startup, before the agent loads: React Native's own modules.
  Only modules from `TurboModuleRegistry` and Expo's `requireNativeModule` after that are wrapped.
- Gesture Handler, Reanimated and Worklets: they call their modules from worklets on the UI thread,
  which needs the native functions.

**Without the wrapping, or with the tracker off:**

- Without `nativeModules: true` the tracker counts nothing: `trackers: { 'native-module': true }` then
  logs a warning, and `quiesco doctor` warns.
- With the wrapping but the tracker off, the calls are still recorded: an action that returns while
  one is pending lists it in its timeline entry, and a failed test's `idle-state.json` lists them
  (`nativeCallsNotCounted`).

## Platform notes {#platform-notes}

- The same trackers run on all three platforms; `native` exists only on iOS.
- Web: the agent reconnects after a full page load, and Quiesco waits for it. With Expo Router's static
  output, the app is ready after hydration.

More in [platform differences](./platforms.md).
