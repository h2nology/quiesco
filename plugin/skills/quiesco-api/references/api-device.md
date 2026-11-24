<!-- Generated from docs/api-device.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# App and device

Relaunch, stop and background the app, and change the device: orientation, dark mode, text size, locale, location, permissions, network, clipboard and status bar.
`app.device` controls the app's process and the device it runs on: start the app again with launch
arguments or a deep link, send it to the background, rotate the screen, switch to dark mode, go offline.
Each change is undone before the next test ([between tests](#between-tests)), so tests stay independent.

System UI outside the app — permission dialogs, biometrics, notifications — is on [system UI](./api-system.md);
screenshots are on [screenshots](./api-screenshots.md).

## App lifecycle {#app-lifecycle}

### `relaunch(options?)` {#relaunch}

```ts
relaunch(options?: RelaunchOptions): Promise<void>
```

Types: [`RelaunchOptions`](./api-types.md#relaunchoptions)

Terminates the app and starts it again — always a new process. The app keeps its data unless `clearData`
or `reinstall` is set. Resolves once the app has connected.

```ts
// typed launch arguments and a deep link: a real cold start, getInitialURL sees the link
await app.device.relaunch({ args: { user: 'ann', retries: 3 }, url: 'myapp://todos/1' });

// a first launch: the app's data is deleted first
await app.device.relaunch({ clearData: true });

// a fresh install, with the camera already allowed
await app.device.relaunch({ reinstall: true, permissions: [Permission.camera] });
```

| Option | Meaning |
|---|---|
| `args` | Launch arguments (any JSON), merged over the config's [`launchArgs`](./config.md#top-level). The app reads them with `quiesco.launchArgs()` ([in-app API](./api-in-app.md)) |
| `url` | Open the app with this deep link. On the web its path is opened |
| `clearData` | Delete the app's data first (native: the app's storage; web: a fresh browser context) |
| `reinstall` | Uninstall and install the app first. Needs the app's `binaryPath`; on the web the same as `clearData` |
| `permissions` | Permissions to grant before the launch, besides the config's ([permissions](./platforms.md#permissions)). After `clearData` / `reinstall` the config's are granted again |

Without `@quiesco/native`, an app that cannot start with the link is started first and the link is opened
after the launch, with a warning: `getInitialURL` will not return it then.

### `terminate()` {#terminate}

```ts
terminate(): Promise<void>
```

Stops the app. Until the next `relaunch()`, every element call fails at once with `APP_NOT_RUNNING`,
without waiting.

```ts
await app.device.terminate();
await app.device.relaunch();
await app.expectVisible('home-screen');
```

### `sendToBackground()` {#sendtobackground}

```ts
sendToBackground(): Promise<void>
```

Goes to the home screen, like the Home button; the process keeps running. Until `bringToForeground()`,
element calls fail with `APP_IN_BACKGROUND`. Not on the web (`ACTION_NOT_SUPPORTED`).

```ts
await app.device.sendToBackground();

// a deep link now opens from outside the app, as from another app
await app.openUrl('myapp://todos/42');
```

### `bringToForeground()` {#bringtoforeground}

```ts
bringToForeground(): Promise<void>
```

Brings the backgrounded app back — the same process, not a restart — and waits until it is active and
idle. Not on the web (`ACTION_NOT_SUPPORTED`).

```ts
await app.device.sendToBackground();
await app.device.bringToForeground();

// the app locked itself while it was away
await app.expectVisible('pin-screen');
```

### `install()` {#install}

```ts
install(): Promise<void>
```

Installs the app binary from the config's `binaryPath` ([apps](./config.md#apps)). A running app is stopped:
start it with `relaunch()`.

```ts
await app.device.install();
await app.device.relaunch();
```

### `uninstall()` {#uninstall}

```ts
uninstall(): Promise<void>
```

Removes the app from the device. The web has nothing to uninstall (`ACTION_NOT_SUPPORTED`): use
`relaunch({ clearData: true })` there.

```ts
await app.device.uninstall();
await app.device.install();
await app.device.relaunch();
```

### `appState` {#appstate}

What the test did to the app last: `'running'`, `'background'` or `'terminated'`. A property, not a method.

```ts
await app.device.sendToBackground();
expect(app.device.appState).toBe(AppRunState.background);
```

### `openUrl(url)` {#openurl}

```ts
openUrl(url: string): Promise<void>
```

The same as [`app.openUrl`](./api-actions.md#openurl): opens a deep link.

```ts
await app.device.openUrl('myapp://settings');
```

### `pressBack()` {#pressback}

```ts
pressBack(): Promise<void>
```

The same as [`app.pressBack`](./api-actions.md#pressback): the Android back button, or the browser's back on
the web.

```ts
await app.device.pressBack();
```

## Network ports {#network-ports}

### `reversePort(port)` {#reverseport}

```ts
reversePort(port: number): Promise<void>
```

Makes a port on the host reachable as `localhost:port` from an Android device (`adb reverse`). A no-op on
the iOS simulator and the web, which share the host's network.

```ts
// the app talks to a mock server on the host
await app.device.reversePort(3001);
```

### `unreversePort(port)` {#unreverseport}

```ts
unreversePort(port: number): Promise<void>
```

Removes a forwarding set with `reversePort`. A no-op on the iOS simulator and the web.

```ts
await app.device.unreversePort(3001);
```

## Device state {#device-state}

### `setOrientation(orientation)` {#setorientation}

```ts
setOrientation(orientation: Orientation): Promise<void>
```

Types: [`Orientation`](./api-constants.md#list)

Rotates the app to `'portrait'` or `'landscape'` and resolves once the app's window has the new shape and
the app is idle. The app must not lock its orientation (app.json `"orientation": "default"`).

```ts
await app.device.setOrientation(Orientation.landscape);
await app.expectVisible('side-by-side-layout');
```

### `setAppearance(scheme)` {#setappearance}

```ts
setAppearance(scheme: ColorScheme): Promise<void>
```

Types: [`ColorScheme`](./api-constants.md#list)

Switches the system color scheme to `'light'` or `'dark'`, and checks that the app reports the new one.
The app must follow the system (app.json `"userInterfaceStyle": "automatic"`).

```ts
await app.device.setAppearance(ColorScheme.dark);
await app.device.screenshot(undefined, { name: 'home-dark' });
```

### `setFontScale(scale)` {#setfontscale}

```ts
setFontScale(scale: number): Promise<number>
```

Sets the system text size, from `0.5` to `4`, and resolves with the scale applied. iOS uses the nearest
Dynamic Type size and applies it live; Android starts the app again (data kept). Not on the web.

```ts
const applied = await app.device.setFontScale(1.3);

// the long title still fits
await app.expectVisible('todo-title', { ratio: 1 });
```

### `setLocale(locale)` {#setlocale}

```ts
setLocale(locale: string | null): Promise<void>
```

Sets the app's language and region, a BCP 47 tag such as `'ja-JP'`; `null` goes back to the device
default. The app is started again with it (data kept).

```ts
await app.device.setLocale('ja-JP');
await app.expectText('add-todo', '追加');

await app.device.setLocale(null);
```

- It passes when the app's preferred language (iOS `AppleLanguages`, what expo-localization reads) or its
  JS locale is the new one.
- iOS resolves `Intl` and the app's native strings only to a language listed in `CFBundleLocalizations`.
  Without it a warning says so; an app localized in JS works as it is.

### `setLocation(latitude, longitude)` {#setlocation}

```ts
setLocation(latitude: number, longitude: number): Promise<void>
```

Sets the simulated GPS position. On Android, emulators only.

```ts
// Tokyo
await app.device.setLocation(35.68, 139.76);
await app.tap('nearby-stores');
```

### `setPermission(name, state)` {#setpermission}

```ts
setPermission(name: Permission, state: PermissionState): Promise<void>
```

Types: [`Permission`](./api-constants.md#list) · [`PermissionState`](./api-constants.md#list)

Changes a permission while the app runs. `state` is `'grant'`, `'revoke'` or `'reset'`; the names are
those of [permissions](./platforms.md#permissions) (`camera`, `microphone`, `location`, `notifications`,
`contacts`, `photos`, `calendar`).

```ts
await app.device.setPermission(Permission.location, PermissionState.revoke);
await app.tap('nearby-stores');
await app.expectVisible('location-denied-banner');

// ask again: the app's next request shows the system dialog
await app.device.setPermission(Permission.camera, PermissionState.reset);
```

- **Revoke on Android** kills the app. Quiesco starts it again (data kept) before resolving, so the app is
  back on its first screen.
- **`'reset'`** means not determined, as after a fresh install: the app's next request shows the system
  dialog again. Android: revoked, with "don't ask again" cleared; iOS: `simctl privacy reset`; web: the
  browser asks.
- **On iOS, notifications and the camera** can only be reset by reinstalling the app. Quiesco reinstalls
  and starts it, **deleting its data** (needs `binaryPath`; a warning says so).

Answering the system's permission dialog itself is on [system UI](./api-system.md#system-allowpermission).

### `setNetwork(state)` {#setnetwork}

```ts
setNetwork(state: NetworkState): Promise<void>
```

Types: [`NetworkState`](./api-constants.md#list)

`'offline'`: the app's new `fetch` / `XMLHttpRequest` / `WebSocket` connections fail as they do without a
network. Quiesco's own connection keeps working, and connections already open stay open. `'online'` undoes
it.

```ts
await app.device.setNetwork(NetworkState.offline);
await app.tap('sync-now');
await app.expectVisible({ text: 'You are offline' });

await app.device.setNetwork(NetworkState.online);
```

- Android also turns Wi-Fi and mobile data off, and the web reports `navigator.onLine === false`, so
  NetInfo sees it there.
- The iOS simulator has no network switch: NetInfo keeps reporting online.
- It lasts across relaunches, until `'online'` or the next test.

To make the app's own requests not count for idle instead, see [runtime synchronization](./api-runtime-sync.md)
(Detox's `setURLBlacklist` is `app.sync.ignoreUrls.add()` here).

### `clipboard.set(text)` {#clipboard-set}

```ts
clipboard.set(text: string): Promise<void>
```

Writes plain text to the device clipboard, inside the app: what the app pastes. Cleared before the next
test.

```ts
await app.device.clipboard.set('SAVE20');
await app.tap('paste-coupon');
await app.expectValue('coupon-input', 'SAVE20');
```

iOS and Android need `@quiesco/native` (≥ Phase 6.6).

### `clipboard.get()` {#clipboard-get}

```ts
clipboard.get(): Promise<string>
```

Reads the device clipboard: what the app copied.

```ts
await app.tap('copy-invite-link');
expect(await app.device.clipboard.get()).toMatch(/^https:\/\/example\.com\/invite\//);
```

iOS and Android need `@quiesco/native` (≥ Phase 6.6); on iOS a read falls back to `simctl pbpaste`.

### `setStatusBar(options)` {#setstatusbar}

```ts
setStatusBar(options: StatusBarOptions): Promise<void>
```

Types: [`StatusBarOptions`](./api-types.md#statusbaroptions)

Overrides the status bar — clock, battery, signal — for clean screenshots. Nothing to do on the web, which
has no status bar.

```ts
await app.device.setStatusBar({ time: '9:41', batteryLevel: 100, wifiBars: 3, cellularBars: 4 });
await app.device.screenshot(undefined, { name: 'store-listing' });
```

| Option | Meaning |
|---|---|
| `time` | The clock, `'H:MM'` / `'HH:MM'`, e.g. `'9:41'` |
| `batteryLevel` | 0–100 |
| `charging` | `true` / `false` |
| `wifiBars` | 0–3 |
| `cellularBars` | 0–4 |
| `dataNetwork` | `'wifi'`, `'3g'`, `'4g'`, `'lte'`, `'5g'`, or `'hide'` to hide the cellular indicator |

### `resetStatusBar()` {#resetstatusbar}

```ts
resetStatusBar(): Promise<void>
```

Back to the real status bar.

```ts
await app.device.resetStatusBar();
```

## Screenshots {#screenshots}

`app.device.screenshot()` takes a PNG of the screen, an element or a whole scrolling page: see
[screenshots](./api-screenshots.md).

## Between tests {#between-tests}

- Before each test Quiesco starts an app a previous test left terminated, and brings a backgrounded one
  back.
- Every device change is undone before the next test, and when the session ends: permissions go back to
  the configured ones, the rest to what the device had. Only what was changed is touched.
- A call that starts the app again (`setLocale`, `setFontScale` on Android, a revoke on Android) leaves it
  on its first screen.
