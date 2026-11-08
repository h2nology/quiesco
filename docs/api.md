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
| `tap(target)` | Tap the element (center) |
| `doubleTap(target)` | Two taps |
| `longPress(target, { durationMs })` | Press and hold |
| `type(target, text)` | Focus the input and enter `text` (native mode: through the IME, so any language works) |
| `clear(target)` | Clear a text input |
| `scroll(target, 'up' \| 'down' \| 'left' \| 'right', { distance })` | Scroll a scroll view |
| `scrollTo(container, target)` | Scroll `container` until `target` is visible |
| `swipe(target, direction, { speed: 'slow' \| 'normal' \| 'fast' })` | A swipe gesture (with inertia) |
| `pressBack()` | Android back button; browser back on the web; not available on iOS |
| `openUrl(url)` | Open a deep link (in the app on iOS, `am start` on Android, the address bar on the web) |
| `dismissKeyboard()` | Hide the software keyboard |

An action needs exactly one **visible** element: it waits until the target exists and is visible (or
fails with `ELEMENT_NOT_FOUND`, saying whether it is missing or hidden) and fails at once with
`MULTIPLE_MATCHES` when several elements match. In `native` mode the touch must also be able to reach the
element: if a dialog or another window covers it, the action fails with `ELEMENT_OBSCURED` naming what is
on top. A software keyboard covering the target is dismissed first.

### Assertions

Assertions retry until they hold or the timeout runs out (`ASSERTION_FAILED` with expected / actual).

| Method | Holds when |
|---|---|
| `expectVisible(target)` | at least one matching element is visible |
| `expectNotVisible(target)` | no matching element is visible (absent or hidden) |
| `expectExists(target)` / `expectNotExists(target)` | an element is / is not in the tree, visible or not |
| `expectText(target, text \| RegExp)` | exactly one match and its text equals / matches |
| `expectProp(target, prop, value)` | exactly one match and the prop has this JSON value (host props first, then its component's, e.g. `disabled`, `value`) |
| `expectCount(target, n)` | exactly `n` elements match |

### Queries, sync and state

| Method | Returns |
|---|---|
| `query(target)` | Summaries of the matching elements (type, testID, text, rect, visible) |
| `getTree()` | The element tree as JSON (also attached to failed scenarios) |
| `waitForIdle({ timeoutMs })` | Waits until idle; resolves with the time it took |
| `getIdleState()` | Every tracker's state — what is busy right now |
| `backdoor(name, ...args)` | Calls a backdoor registered in the app; arguments and result are JSON |
| `reset()` | Soft reset (Quiesco does this before every scenario) |

## Matchers

A plain string is a **testID**: `tap('add-todo')`. An object combines conditions:

```ts
{ id: 'todo-item', index: 0 }                  // first of several
{ text: 'Save' }                                // displayed text, exact
{ text: /saved \d+ items/i }                    // or a regular expression
{ label: 'Close' }                              // accessibilityLabel / aria-label
{ role: 'button', text: 'Save' }                // accessibilityRole / role
{ text: 'Delete', within: 'todo-item-3' }       // inside another element (a matcher or testID)
```

`text` matches the deepest element whose own text matches (a button and its label do not both match).
On the web `testID` is rendered as `data-testid`; matchers are the same on every platform.

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
