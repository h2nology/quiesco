---
name: quiesco-api
description: This skill should be used when writing or reading code that calls Quiesco — `this.app` in Cucumber steps, `app` from `@quiesco/vitest`, `quiesco.app` in Jest, `@quiesco/agent` (`QuiescoRoot`, `quiesco.backdoor`, `onReset`), or `quiesco.config.ts` — or when the user asks "how do I tap / scroll / assert … in Quiesco", "what matcher finds …", "how does Quiesco wait for idle", "which config option …", "how do I set up a backdoor", "how do I run tests in parallel", "how do I mock the network", "what does sync false do", "migrate from Detox to Quiesco", or asks what a Quiesco error name means or how to avoid it while writing code (a test that already failed is the debug skill's job). Provides the Driver API, matchers, in-app API, configuration, synchronization model and platform differences.
---

# Quiesco API

Quiesco is a gray-box e2e test framework for Expo apps (iOS, Android, web). An agent inside the e2e
build tells the host when the app is idle, so every Driver call waits by itself. The full API lives in
`references/`; this file holds the rules that keep generated code correct and the map of where to look.

## Rules that are easy to get wrong

1. **Never sleep or poll.** Every Driver call (`this.app` in Cucumber, `app` in Vitest, `quiesco.app` in Jest) waits for idle before it (and actions also after it).
   No `setTimeout`, no `waitFor` loops, no `waitForIdle()` between actions. When an app never settles,
   fix the cause (see "Synchronization" below), do not add waits.
2. **A plain string is a testID.** `tap('add-todo')` matches `testID="add-todo"` (rendered as
   `data-testid` on the web). Other conditions go in an object: `{ text: 'Save' }`,
   `{ role: 'button', text: 'Save' }`, `{ id: 'todo-item', index: 0 }`, `{ text: 'Delete', within: 'todo-item-3' }`,
   `{ type: 'button', has: { text: 'Buy milk' } }`, `{ id: /^todo-\d+$/ }`.
3. **Actions need exactly one match.** Several matches fail with `MULTIPLE_MATCHES`; narrow with
   `index`, `within`, `has` or a more specific testID.
4. **Prefer Quiesco assertions over `assert` on a query.** `expectText`, `expectVisible`, `expectCount`
   and the chained `this.app.expect(target).toHaveText(…)` retry until they hold. A plain `assert` on
   `query()` checks once — acceptable only right after an action.
5. **Set up state through backdoors, not the UI.** Register in the app with
   `quiesco.backdoor('loginAs', async (email) => …)`, call with `this.app.backdoor('loginAs', email)`.
   Arguments and results must be JSON. Register backdoors in a module imported only when
   `process.env.EXPO_PUBLIC_QUIESCO === '1'`.
6. **Platform differences go through `this.app.platform`** (`'ios' | 'android' | 'web'`) or scenario tags
   (`@ios`, `@android`, `@web`, `@native`); the innermost tag wins. `pressBack()` does not exist on iOS —
   use `goBack()` for "back as a user would" on every platform.
7. **Each scenario starts from a soft reset** (storage cleared, `onReset` hooks, navigation restored,
   remount). Do not rely on state left by an earlier scenario; `@hard-reset` relaunches the app.

## Where to call it from

| Runner | Driver | Setup |
|---|---|---|
| Vitest (recommended) | `test('…', async ({ app }) => …)` from `@quiesco/vitest` | `plugins: [quiescoPlugin()]`, `test: { ...quiesco() }` from `@quiesco/vitest/config` |
| Jest | global `quiesco.app` | `preset: '@quiesco/jest'` |
| Cucumber | `this.app` in steps (`QuiescoWorld`) | `import '@quiesco/cucumber/register'` or `registerQuiesco({ world })` |
| Anything else | `new Lifecycle()` from `@quiesco/core` | see `references/api.md` "Vitest, Jest and other runners" |

## Driver at a glance

- **Actions:** `tap`, `doubleTap`, `longPress`, `type`, `replaceText`, `clear`, `pressKey`, `scroll`,
  `scrollTo(container, target)`, `scrollToEdge`, `scrollToIndex`, `swipe`, `drag`, `tapAt`, `goBack`,
  `pressBack` (not on iOS), `openUrl`, `dismissKeyboard`, `setValue` (slider, switch, picker, segmented control,
  date/time picker), `adjustSlider`, `accessibilityAction`, `pinch`, `rotate`, `multiTouch`.
- **Assertions:** `expectVisible` / `expectNotVisible`, `expectExists` / `expectNotExists`, `expectText`,
  `expectValue`, `expectLabel`, `expectFocused`, `expectEnabled` / `expectDisabled`, `expectChecked`,
  `expectProp`, `expectCount`; chained form `expect(target).not.toBeChecked()` etc.
- **Queries:** `query`, `attributes`, `getTree`, `getIdleState`, `backdoor`, `reset`, `platform`.
- **Runtime sync (`this.app.sync`), for the rest of one scenario:** `disableTracker('timer')`,
  `ignoreElements.add('poll-count')`, `ignoreUrls.add(/analytics/)`, `disable()` / `enable()`.
- **Device (`this.app.device`):** relaunch, terminate, background, permissions, location, status bar,
  system dialogs (`device.system.tap(…)`), `screenshot(target?, { name })`.
- **WebView:** `this.app.webview('id').element({ css })`.
- **Per-call options (last argument):** `{ timeoutMs }`, `{ sync: false }` for a screen with an endless
  animation, `{ mode: 'native' | 'js' }` for actions.

Look up exact signatures in `references/api.md` before using a less common method. It is large; grep
it by method name or list its headings:
`grep -n 'scrollToIndex' "${CLAUDE_PLUGIN_ROOT}/skills/quiesco-api/references/api.md"`,
`grep -n '^##' "${CLAUDE_PLUGIN_ROOT}/skills/quiesco-api/references/api.md"`.

## Synchronization

Idle means every tracker is idle twice in a row: `network`, `timer` (timeouts ≤ 1.5 s),
`react`, `idle-callback`, `native` (iOS transitions, keyboard) and `frame-stable` (element tree unchanged
for 2 frames). A `SYNC_TIMEOUT` lists what was busy. Typical fixes — for one scenario prefer
`this.app.sync.*` or `{ sync: false }`; change `quiesco.config.*` only for app-wide causes:

- `network`: endless request, long polling, analytics → `sync.ignoreUrls` (or fix the backend / mock)
- `frame-stable`: decorative looping animation → give it a testID and add it to `sync.ignoreElements`;
  a spinner or counter that matters → `{ sync: false }` on that step's calls, then assert
- `timer`: a short `setTimeout` re-armed forever → `this.app.sync.disableTracker('timer')` or
  `{ sync: false }` for that scenario / step, or stop the loop in e2e builds. Only timers with a delay
  ≤ `sync.timerThresholdMs` (1.5 s) count, so a lower threshold (below the loop's delay) also stops
  it from blocking — app-wide, for every short timer.
- `react`: a render loop that never settles → a real bug in the app; report it, do not work around it
- very few `frames sampled` → the device is starved (overloaded emulator), not animating

Details per tracker: `references/sync.md` ("When the app never becomes idle").

## Configuration

`quiesco.config.ts` / `.mts` at the project root, `defineConfig` from `@quiesco/core`. Main keys:
`apps.{ios,android,web}`, `devices.*`, `permissions`, `sync.*`, `actions.mode`, `reset.default` /
`reset.expectVisible`, `devServer`, `artifacts`, `appErrors.ignore`, `tags`. Every option with its type
and default is in `references/config.md`.

## Additional resources

Read the reference that matches the task; they are generated from the official docs and match this
plugin's Quiesco version.

- **`references/api.md`** — the complete API: Driver (actions, value controls, gestures, assertions,
  queries, device, screenshots, WebView, runtime sync), matchers and semantic types, in-app API and typed
  backdoors, configuration table, scenario tags, error names, artifacts, other runners. Large: grep by
  heading or method name instead of reading it whole.
- **`references/sync.md`** — trackers and what to do for each kind of `SYNC_TIMEOUT`.
- **`references/platforms.md`** — iOS / Android / web differences, permissions, keyboards, system dialogs.
- **`references/parallel.md`** — `--workers N`, one device per worker, isolation rules.
- **`references/config.md`** — every `quiesco.config` option with its type and default.
- **`references/runners.md`** — the three runners compared and how to choose one.
- **`references/vitest.md`**, **`references/jest.md`**, **`references/cucumber.md`** — each runner's
  setup in full: its config file, options, hooks and how tests reach the app.

For writing features and steps, see the `writing-tests` skill; for failures, `/quiesco:debug`.
