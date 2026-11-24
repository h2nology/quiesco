<!-- Generated from docs/api.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# API reference

How tests talk to the app: the driver, how every call waits for the app, the options all calls take, and where each part of the API is described.
A test drives the app through one object, the **driver**. It taps, types and scrolls like a user, checks
what is on screen, and reaches into the app for setup. This section describes every method, one page per
topic, with an example for each.

## The driver {#driver-thisapp}

The driver is the same object in every test runner; only the way a test gets it differs:

**Vitest:**

```ts
import { test } from '@quiesco/vitest';

test('a new todo appears in the list', async ({ app }) => {
  await app.tap('add-todo');
});
```

**Jest:**

```js
test('a new todo appears in the list', async () => {
  await quiesco.app.tap('add-todo');
});
```

**Cucumber:**

```ts
import { When } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';

When('I add a todo', async function (this: QuiescoWorld) {
  await this.app.tap('add-todo');
});
```

The examples in this section use the Vitest form, `app`. With Jest write `quiesco.app`, in Cucumber steps
`this.app`. The fixed strings in the examples are [constants](./api-constants.md) (`Direction.left`,
`Tag.native` …), imported from the runner's package (`@quiesco/vitest`, `@quiesco/cucumber`); with Jest
they are on the global as well (`quiesco.Direction`).

Under each method's heading is its signature, and links to the [types](./api-types.md) it names (`MatcherInput`,
`TapOptions`, `ElementSummary` …). They are exported by `@quiesco/core`, for helpers of your own:
`import type { MatcherInput, TapOptions } from '@quiesco/core'`.

## Every call waits for the app {#every-call-waits}

Every method is `async`. Before it runs, it waits until the app is **idle**: no pending timers, requests,
renders or animations ([synchronization](./sync.md)). An action waits again after it is done. So a test never
sleeps or polls:

```ts
// the tap returns once the new screen has finished its transition and its requests
await app.tap('open-settings');

// so this runs on the new screen
await app.tap('dark-mode-switch');
```

Assertions (`expectVisible`, `expectText`, …) also retry until they hold, up to the call's timeout.

## Options every call takes {#call-options}

Every method takes an optional last argument:

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `sync.timeoutMs` (10 s) | How long this call may wait |
| `sync` | `true` | `false`: do not wait for idle around this call. For a screen whose animation never stops |
| `mode` | `actions.mode` | Actions only. `'native'`: real touches and keyboard input (iOS / Android with `@quiesco/native`, the browser on the web). `'js'`: call the component's callbacks (`onPress`, `onChangeText`) |

```ts
// a slow screen: wait up to 30 s for it
await app.expectVisible('report', { timeoutMs: 30_000 });

// a looping animation on this screen: do not wait for idle
await app.tap('stop-animation', { sync: false });

// call onPress instead of touching the screen
await app.tap('hidden-debug-button', { mode: ActionMode.js });
```

## Finding elements {#finding-elements}

Most methods take a **target**: which element to act on. A string is a `testID`; an object combines
conditions such as the text, the role or the position. See [matchers](./api-matchers.md).

```ts
await app.tap('save');
await app.tap({ role: 'button', text: 'Save' });
await app.expectText({ id: 'todo-title', index: 0 }, 'Buy milk');
```

An action needs exactly **one visible** element. It waits until the target exists and is visible, and fails
with `ELEMENT_NOT_FOUND` if it does not appear in time (the message says whether it is missing or hidden).
Several matches fail at once with `MULTIPLE_MATCHES`. In `native` mode a touch must also be able to reach
the element: if a dialog or another view covers it, or a scroll view cuts off the point to touch, the
action fails with `ELEMENT_OBSCURED` naming what is in the way. A software keyboard covering the target is
dismissed first.

## The API by topic {#by-topic}

- [Matchers](./api-matchers.md): How a target finds elements: test id, text, role, type, position, ancestors.
- [Actions](./api-actions.md): Tap, type, scroll, swipe, drag, go back, open a deep link.
- [Value controls](./api-value-controls.md): Switches, sliders, pickers, segmented controls, date pickers.
- [Multi-finger gestures](./api-gestures.md): Pinch, rotate, and any touch paths.
- [Assertions](./api-assertions.md): Visible, text, value, enabled, checked, count — retried until they hold.
- [Queries and state](./api-queries.md): Read elements and the tree, wait for idle, call backdoors, reset.
- [Runtime synchronization](./api-runtime-sync.md): Change what the driver waits for during a test.
- [App and device](./api-device.md): Relaunch, background, orientation, dark mode, locale, network, clipboard.
- [System UI](./api-system.md): Permission dialogs, biometrics, notifications, browser dialogs.
- [Screenshots](./api-screenshots.md): The screen, an element, or a whole scrolling page.
- [WebView](./api-webview.md): Elements of a web page inside the app.
- [In-app API](./api-in-app.md): What the app registers: backdoors, reset hooks, storage, launch arguments.
- [Test tags](./api-tags.md): Run a test only on some platforms or browsers, or after a full restart.
- [Constants](./api-constants.md): Tags, directions, permissions, error names … as constants instead of hand-written strings.
- [Types](./api-types.md): Every type the signatures name: options, results, matchers.
- [Errors](./api-errors.md): Every error a call can fail with, and what it means.
- [Artifacts](./api-artifacts.md): Screenshots, element trees, videos, logs and timelines of a run.
- [Other test runners](./api-custom-runners.md): Vitest and Jest adapters in detail, and driving Quiesco from any runner.

Every configuration option is on the [configuration](./config.md) page.
