<!-- Generated from docs/config.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Configuration

Every option of quiesco.config.mts, with its type and default.
Quiesco reads its settings from `quiesco.config.ts` in the directory you run it from. `quiesco.config.mts`,
`.js` and `.mjs` work too; `quiesco init` writes `quiesco.config.mts`. To use another file, set
`QUIESCO_CONFIG` to its path.

```ts
import { defineConfig } from '@quiesco/core';

export default defineConfig({
  apps: {
    ios: { bundleId: 'com.example.app', binaryPath: 'ios/build/…/App.app' },
    android: { package: 'com.example.app', binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk' },
    web: { distDir: 'dist' },
  },
  devices: {
    ios: { device: 'iPhone 17' },
    android: { avd: 'Pixel_9_API_37' },
    web: { viewport: { width: 390, height: 844, hasTouch: true, isMobile: true } },
  },
  permissions: ['location'],
  sync: { ignoreUrls: [/\/analytics\//] },
});
```

Only `apps` is required, and only for the platforms you test. Everything else has a default.

- The file must default-export the config. `defineConfig` only adds types.
- It is plain TypeScript, so values can come from the environment, e.g.
  `device: process.env.QUIESCO_IOS_DEVICE ?? 'iPhone 17'`. Node runs it directly, so use only syntax that
  can be erased (no `enum`, no `namespace`).
- The platform is not part of the config: it comes from `quiesco test --platform` or `QUIESCO_PLATFORM`.

## A config per worker {#config-per-worker}

For [parallel runs](./parallel.md), the config can be a function. It is called once per worker:

```ts
export default defineConfig(({ workerIndex, workerCount }) => ({
  apps: {
    android: {
      package: 'com.example.app',
      // each worker's mock backend
      reversePorts: [3001 + workerIndex],
    },
  },
}));
```

`workerIndex` is 0-based; when running serially it is `0` and `workerCount` is `1`.

## Top level {#top-level}

- **`appDir`** (`string`, default `the config file's directory`):
  The Expo app's directory, relative to the config file. Set it when the tests live in a package of their
  own (a monorepo, or `app/` and `e2e/` side by side). `quiesco doctor`, `build` and `init --upgrade` work on
  the app there, and `quiesco test` starts Metro there ([tests in a package of their own](../../setup/references/cli.md#app-dir)).

- **`permissions`** (`Permission[]`, default `[]`):
  Permissions granted before the app launches, so no system dialog interrupts a scenario: `camera`,
  `microphone`, `location`, `notifications`, `contacts`, `photos`, `calendar`. A permission a platform cannot
  pre-grant is skipped with a warning ([per platform](./platforms.md#permissions)).

- **`launchArgs`** (`Record<string, JSON>`):
  Launch arguments every launch passes to the app, any JSON. The app reads them with
  `quiesco.launchArgs()`. `app.device.relaunch({ args })` merges its own over these (shallow).

- **`connectTimeoutMs`** (`number`, default `30000 (90000 for the first launch)`):
  How long to wait for the app to connect after launch. The session's first launch gets 90 s by default,
  because it comes right after installing (Android verifies the new APK then). When set, the value is used
  for every launch.

- **`bailOnRepeatedFailure`** (`number | false`, default `3`):
  After this many scenarios in a row fail the same way (same error at the same step), print a hint with the
  current route and skip the rest: the app is most likely stuck in a state every scenario inherits. `false`
  runs every scenario (the hint is still printed after 3).

- **`logLevel`** (`'debug' | 'info' | 'warn' | 'error' | 'off'`, default `'warn'`):
  The lowest level of the app's console messages forwarded to the test output. `'off'` forwards none.

## apps {#apps}

Which app to launch on each platform. Configure only the platforms you test.

### apps.ios {#apps-ios}

- **`apps.ios.bundleId`** (`string`, required):
  Bundle identifier, e.g. `com.example.app`.

- **`apps.ios.binaryPath`** (`string`):
  The simulator build (`.app`) to install, relative to the config file. Omit it when the app (e.g. a dev
  client) is already installed.

- **`apps.ios.devClient`** (`{ metroUrl?: string }`):
  Launch through an Expo dev client that loads its JS from Metro at `metroUrl` (passed as `--initialUrl`).

### apps.android {#apps-android}

- **`apps.android.package`** (`string`, required):
  Application id, e.g. `com.example.app`.

- **`apps.android.binaryPath`** (`string`):
  The APK to install, relative to the config file. Omit it when the app (e.g. a dev client) is already
  installed.

- **`apps.android.activity`** (`string`, default `'.MainActivity'`):
  The activity launched in a standalone build.

- **`apps.android.devClient`** (`{ scheme: string; metroUrl?: string }`):
  Launch through an Expo dev client: `scheme` is the app's URL scheme, `metroUrl` the Metro it loads its JS
  from.

- **`apps.android.reversePorts`** (`number[]`):
  Host ports the app calls on `localhost` (e.g. a local mock backend), forwarded with `adb reverse`.

### apps.web {#apps-web}

Set `distDir` or `url`.

- **`apps.web.distDir`** (`string`):
  The output of `npx expo export --platform web`. A static export is served by Quiesco (with SPA fallback);
  a `web.output: "server"` export is hosted with `npx expo serve`.

- **`apps.web.url`** (`string`):
  The URL of a running server, e.g. `http://localhost:8081` for `expo start --web`.

- **`apps.web.path`** (`string`, default `'/'`):
  The path opened on launch.

## devices {#devices}

Which simulator, emulator or browser to run on. Nothing is built in: device names, OS versions and
viewports always come from here.

### devices.ios {#devices-ios}

- **`devices.ios.device`** (`string`, default `the booted simulator`):
  Simulator name, e.g. `iPhone 17`. Booted if needed.

- **`devices.ios.os`** (`string`):
  iOS version of the simulator runtime, e.g. `27.0`, when several runtimes have that device.

- **`devices.ios.udid`** (`string`):
  Use exactly this simulator.

- **`devices.ios.udids`** (`string[]`):
  Parallel runs: worker N uses `udids[N]`. Without it, worker 0 uses the simulator above and every other
  worker one named "&lt;name&gt; (Quiesco N)", created on first use and kept
  ([which device each worker uses](./parallel.md#which-device-each-worker-uses)).

- **`devices.ios.bootTimeoutMs`** (`number`, default `180000`):
  How long to wait for a simulator to boot.

- **`devices.ios.shutdown`** (`boolean`, default `false`):
  Shut down a simulator Quiesco booted when the run ends. Leaving it running makes the next run faster.

- **`devices.ios.disablePasswordAutoFill`** (`boolean`, default `true`):
  Turn off password AutoFill, so iOS never covers the app with its "Save Password?" sheet after a login form
  is submitted.

### devices.android {#devices-android}

- **`devices.android.avd`** (`string`, default `a running device`):
  The AVD to boot (cold) when no matching emulator is running.

- **`devices.android.serial`** (`string`):
  Use exactly this adb serial, e.g. `emulator-5554`.

- **`devices.android.serials`** (`string[]`):
  Parallel runs: worker N uses `serials[N]`. Without it, worker 0 uses the device above and every other
  worker an AVD of its own, `<avd>_quiesco_N`, created from `avd` on first use and kept
  ([which device each worker uses](./parallel.md#which-device-each-worker-uses)).

- **`devices.android.bootTimeoutMs`** (`number`, default `180000`):
  How long to wait for an emulator to boot.

- **`devices.android.gpu`** (`string`, default `the AVD's mode`):
  The `-gpu` mode of the emulators Quiesco boots (`host`, `lavapipe`, `swiftshader_indirect`, …). On macOS,
  `auto` (or no mode) becomes `host`: there the emulator would turn `auto` into `lavapipe`, a CPU renderer
  that keeps about 4 cores busy per emulator. Emulators that are already running keep their mode; Quiesco
  warns when it is a CPU renderer.

- **`devices.android.shutdown`** (`boolean`, default `false`):
  Shut down an emulator Quiesco booted when the run ends. Leaving it running makes the next run faster.

### devices.web {#devices-web}

- **`devices.web.browser`** (`'chromium' | 'firefox' | 'webkit'`, default `'chromium'`):
  The browser. Browser tags (`@chromium`, `@firefox`, `@webkit`) pick scenarios by it
  ([differences](./platforms.md#browsers)).

- **`devices.web.headless`** (`boolean`, default `true`):
  Run the browser without a window.

- **`devices.web.viewport`** (`object`):
  The page size. Without it, the browser's default is used.

  - **`width`** (`number`, required)
  - **`height`** (`number`, required)
  - **`deviceScaleFactor`** (`number`, default `1`)
  - **`hasTouch`** (`boolean`, default `false`):
    Touch events: taps are sent with the touchscreen instead of the mouse.
  - **`isMobile`** (`boolean`, default `false`)

## sync {#sync}

How Quiesco decides that the app is idle before each call ([synchronization](./sync.md)).

- **`sync.timeoutMs`** (`number`, default `10000`):
  How long a call waits for the app to become idle before failing with `SYNC_TIMEOUT`.

- **`sync.timerThresholdMs`** (`number`, default `1500`):
  Timers with a delay up to this long keep the app busy; longer ones do not.

- **`sync.countIntervals`** (`boolean`, default `false`):
  Whether a running `setInterval` keeps the app busy.

- **`sync.stableFrames`** (`number`, default `2`):
  How many frames in a row the element tree must stay the same.

- **`sync.ignoreUrls`** (`(string | RegExp)[]`, default `[]`):
  Requests that never keep the app busy, e.g. analytics or long polling. Strings match as substrings.

- **`sync.ignoreElements`** (`Matcher[]`, default `[]`):
  Elements (with their subtrees) left out of the frame-stable check, e.g. `['logo-glow']` for a decorative
  animation that runs for minutes. Other trackers (network, timers, React) are not affected.

- **`sync.trackers`** (`Record<TrackerName, boolean>`, default `all on`):
  Turn off individual trackers, e.g. `{ 'frame-stable': false }`. Trackers: `network`, `timer`, `react`,
  `idle-callback`, `frame-stable`, `native`, `native-module`. `native-module` is on only when the build
  wraps native modules ([trackers](./sync.md#trackers)).

- **`sync.nativeCallThresholdMs`** (`number`, default `2000`):
  `native-module` tracker: how long a pending native module call keeps the app busy.

- **`sync.ignoreNativeCalls`** (`(string | RegExp)[]`, default `[]`):
  `native-module` tracker: calls that never keep the app busy, as `"Module.method"`. Strings match as
  substrings. These are added to the calls that wait for the user, which are ignored by default
  ([native module calls](./sync.md#native-module-calls)).

- **`sync.defaultIgnoreNativeCalls`** (`boolean`, default `true`):
  `native-module` tracker: `false` makes the calls that wait for the user (permission requests, pickers,
  authentication and share sheets) keep the app busy too.

## actions {#actions}

- **`actions.mode`** (`'native' | 'js'`, default `'native' if the app has @quiesco/native, else 'js'`):
  `native` sends real input events; `js` calls the elements' handlers. `native` needs `@quiesco/native` in
  the app.

- **`actions.gestureSlop`** (`{ pinch?: number; rotation?: number }`, default `per platform`):
  How far the fingers move before the app's pinch / rotation recognizers activate (logical units, radians).
  `pinch` and `rotate` move this much first. The defaults fit the standard recognizers (UIKit,
  react-native-gesture-handler); set it for other recognizers, or `0` for no compensation
  ([multi-finger gestures](./api.md#multi-finger-gestures)).

## reset {#reset}

How the app is brought back to its initial state before each scenario.

- **`reset.default`** (`'soft' | 'hard'`, default `'soft'`):
  `hard` relaunches the app before every scenario. A single scenario can ask for it with `@hard-reset`.

- **`reset.expectVisible`** (`Matcher`):
  An element that must be visible after every reset, e.g. `{ id: 'home' }`. If it is not, the reset fails
  with `RESET_FAILED` instead of the scenario's first step failing in a confusing way. Expo Router apps
  already have the route checked; this works for any app.

## devServer {#devserver}

The Metro dev server the app loads its JS from. When the app needs Metro (`devClient.metroUrl`, or
`apps.web.url`) and nothing answers there, `quiesco test` starts one with `EXPO_PUBLIC_QUIESCO=1`, waits
until it is ready, and stops it afterwards. A Metro you started yourself is reused.

- **`devServer.autoStart`** (`boolean`, default `true`):
  Start Metro when it is not running. Only for a URL on this machine (`localhost`, `127.0.0.1`, `[::1]`).

- **`devServer.command`** (`string[]`, default `['npx', 'expo', 'start', '--port', '{port}']`):
  The command that starts it. `{port}` is replaced with the port from the URL.

- **`devServer.timeoutMs`** (`number`, default `120000`):
  How long to wait for it to be ready.

## artifacts {#artifacts}

Files recorded for each scenario, under `artifacts/<date-time>-<platform>/<nnn>-<scenario>/`
([what is in them](./api.md#artifacts)). Each of `video`, `logs` and `timeline` takes a policy: `'none'`,
`'failing'` (recorded for every scenario, kept when it fails) or `'all'`. `QUIESCO_ARTIFACTS=none|failing|all`
sets all three for one run.

- **`artifacts.dir`** (`string`, default `'artifacts'`):
  Where runs are written, relative to the working directory. For parallel runs with another directory, pass
  it to the config plugin too: `withQuiesco(config, { artifactsDir })`.

- **`artifacts.video`** (`'none' | 'failing' | 'all'`, default `'none'`):
  A screen recording. It costs a little on every scenario; turn it on in CI.

- **`artifacts.logs`** (`'none' | 'failing' | 'all'`, default `'failing'`):
  The device log of the app.

- **`artifacts.timeline`** (`'none' | 'failing' | 'all'`, default `'failing'`):
  Every call on the app with its duration and how long it waited for idle.

## appErrors {#apperrors}

Uncaught errors in the app fail the current step. These options decide which ones do not.

- **`appErrors.ignore`** (`(string | RegExp)[]`, default `[]`):
  App errors that only log a warning instead of failing the step, matched against the message. Strings
  match as substrings. They are also left out of the `console.error`s a failure lists.

- **`appErrors.ignoreDefaults`** (`boolean`, default `true`):
  Also ignore known framework reports that are not real failures, such as Expo Router's lazy routes on the
  web reporting `Requiring unknown module "…"`.

- **`appErrors.logBox`** (`'clear' | 'ignore' | 'keep'`, default `'clear'`):
  React Native's LogBox in dev builds. Its toast covers the bottom of the screen, so taps there would fail.
  `'clear'` clears its logs on every soft reset, `'ignore'` shows no LogBox notifications at all (the errors
  still reach the failure message), `'keep'` leaves it alone
  ([LogBox covers the app](../../debug/references/troubleshooting.md#logbox)).

## server {#server}

The WebSocket server on the host that the app connects to.

- **`server.port`** (`number`, default `7357`):
  Its port. In parallel runs, worker N listens on `server.port + N`.

- **`server.host`** (`string`, default `all interfaces`):
  The interface to listen on.

## tags {#tags}

- **`tags`** (`object`):
  Rename the [scenario tags](./api.md#scenario-tags) Quiesco reacts to, e.g.
  `{ web: '@browser', webkit: '@safari' }`. With Vitest, pass the same to `quiesco({ tags })` in
  `vitest.config.ts`.

  - **`ios`** (`string`, default `'@ios'`)
  - **`android`** (`string`, default `'@android'`)
  - **`web`** (`string`, default `'@web'`)
  - **`native`** (`string`, default `'@native'`)
  - **`chromium`** (`string`, default `'@chromium'`)
  - **`firefox`** (`string`, default `'@firefox'`)
  - **`webkit`** (`string`, default `'@webkit'`)
  - **`hardReset`** (`string`, default `'@hard-reset'`)
