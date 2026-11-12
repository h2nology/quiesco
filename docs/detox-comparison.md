# Quiesco and Detox

Item-by-item comparison with **Detox 20.51.4** (its documentation and source at 667efcb, read 2026-11-08).
The Detox column is taken from that documentation, source and issue tracker, not measured. The Quiesco
columns are measured: each item names the example-app feature (`examples/todo-app/features/`) or the
unit tests that check it, and the full example suite passes on all three platforms (results at the end).

Legend: ✓ supported · ✗ not available · — does not apply on that platform · (iOS) / (Android) Detox
supports it on that platform only.

## Element actions

| Detox | Detox platforms | Quiesco | iOS | Android | Web | Verified by |
|---|---|---|---|---|---|---|
| `tap(point?)` | both | `tap(target, { point })` | ✓ | ✓ | ✓ | actions: 点击区域内的指定位置 |
| `multiTap(n)` | both | `multiTap(target, n)`, `doubleTap(target)` | ✓ | ✓ | ✓ | actions: 连续点击… |
| `longPress(point?, duration?)` | both | `longPress(target, { durationMs, point })` | ✓ | ✓ | ✓ | unit tests (agent actions, driver) |
| `longPressAndDrag(…)` | both | `drag(target, to, { holdMs, speed })` — to an element or a point | ✓ | ✓ | ✓ | actions: 拖拽方块放进区域; showcase: 长按后拖动列表行排序 |
| `swipe(dir, speed?, offset?, x?, y?)` | both | `swipe(target, dir, { speed, distance, from })` | ✓ | ✓ | ✓ | showcase: 没有长按就滑动不会拿起列表行 |
| `scroll(offset, dir, x?, y?)` | both | `scroll(target, dir, { distance, from })` | ✓ | ✓ | ✓ | unit tests (agent actions, driver) |
| `scrollTo(edge)` | both | `scrollToEdge(target, edge)` (follows a growing virtualized list) | ✓ | ✓ | ✓ | actions: 长列表滚动到指定行和两端 |
| `scrollToIndex(i)` | **Android** | `scrollToIndex(list, i, { viewPosition })`, also without `getItemLayout` | ✓ | ✓ | ✓ | actions: 长列表滚动到指定行和两端 |
| `whileElement(…).scroll(…)` | both | `scrollTo(container, target)` | ✓ | ✓ | ✓ | unit tests (driver) |
| `typeText` / `replaceText` / `clearText` | both | `type` (through the IME: any language) / `replaceText` / `clear` | ✓ | ✓ | ✓ | login, new-todo; actions: 键盘按键与替换文本 |
| `tapReturnKey` / `tapBackspaceKey` | both | `pressKey(target, 'enter' \| 'backspace')` — reaches the field even when the keyboard key is out of reach | ✓ | ✓ | ✓ | actions: 键盘按键与替换文本; new-todo: 在标题框按回车也能保存 |
| `setColumnToValue` | **iOS** | `setValue(picker, value)` — iOS turns the wheel with a finger | ✓ | ✓ (callbacks: the dropdown is another window) | ✓ (`<select>`) | values: 选择器按名称或值选择 |
| `setDatePickerDate` | both | `setValue(datePicker, Date)` — iOS turns every wheel column | ✓ | ✓ (callbacks: system dialog) | ✓ (date input) | values: 日期 |
| `adjustSliderToPosition` | both | `adjustSlider(target, position)` (real drag, read back and corrected); `setValue(slider, n)` (exact) | ✓ | ✓ | ✓ | values: 把滑块设为指定值, 拖动滑块到指定位置 |
| `pinch(scale, speed, angle)` | **iOS** | `pinch(target, scale, { angle, speed })`, compensated for recognizer activation | ✓ | ✓ | ✓ (touch viewports) | gestures: 双指放大 / 缩小 / 沿斜线方向捏合 |
| — | — | `rotate(target, radians)`, `multiTouch(fingers)` | ✓ | ✓ | ✓ (touch viewports) | gestures: 双指旋转, 双指滑动 |
| `performAccessibilityAction` | both | `accessibilityAction(target, name)` (VoiceOver / TalkBack paths) | ✓ | ✓ | ✓ | values: 无障碍动作 |
| — (switch: tap) | both | `setValue(switch, boolean)`; segmented control | ✓ | ✓ | ✓ | values: 开关, 分段控件 |
| `getAttributes` | both | `attributes(target)`, `query(target)` | ✓ | ✓ | ✓ | device: 横屏 (rects of the two columns) |
| `takeScreenshot(name)` (element) | both | `device.screenshot(target, { full, name })` — also the whole element / page, stitched | ✓ | ✓ | ✓ | screenshots (4 scenarios) |

## Matchers

| Detox | Detox platforms | Quiesco | iOS | Android | Web | Verified by |
|---|---|---|---|---|---|---|
| `by.id` / `by.text` / `by.label` (RegExp) | both | `'id'`, `{ id }`, `{ text }`, `{ label }` (strings or RegExp) | ✓ | ✓ | ✓ | every feature |
| `by.type` (class name) | both | `{ type }`: semantic type (same on every platform), host type or component name | ✓ | ✓ | ✓ | unit tests (agent query) |
| `by.traits` | **iOS** | **Alternative**: `{ role }` (accessibility role) and the semantic `{ type }` (`button`, `header`, `link`, `image`, …) | ✓ | ✓ | ✓ | unit tests (agent query) |
| `withAncestor` / `withDescendant` / `and` | both | `within`, `has`, combined conditions, `not` | ✓ | ✓ | ✓ | unit tests (agent query) |
| `atIndex(i)` (order differs between iOS and Android) | both | `index` — render order on every platform | ✓ | ✓ | ✓ | unit tests (agent query) |

## Assertions

| Detox | Detox platforms | Quiesco | iOS | Android | Web | Verified by |
|---|---|---|---|---|---|---|
| `toBeVisible(pct = 75)` | both | `expectVisible(target, { ratio })` — any visible pixel by default; clipping by scroll views counted | ✓ | ✓ | ✓ | every feature; actions: 长列表滚动… |
| `toExist` | both | `expectExists` / `expectNotExists` | ✓ | ✓ | ✓ | unit tests (driver) |
| `toBeFocused` | both | `expectFocused` / `expectNotFocused` | ✓ | ✓ | ✓ | form-state |
| `toHaveText` / `toHaveLabel` / `toHaveId` / `toHaveValue` | both | `expectText` / `expectLabel` / `toHaveId` / `expectValue` | ✓ | ✓ | ✓ | every feature |
| `toHaveSliderPosition` / `toHaveToggleValue` | both | `expectValue` (slider / switch / picker) / `expectChecked` | ✓ | ✓ | ✓ | values |
| — | — | `expectEnabled` / `expectDisabled`, `expectProp`, `expectCount` | ✓ | ✓ | ✓ | form-state; unit tests |
| `.not` | both | `.not` (chained form) and `expectNot…` | ✓ | ✓ | ✓ | unit tests (driver) |
| `waitFor(…).withTimeout()` (expect does not wait) | both | every assertion retries until it holds or the timeout (`sync.timeoutMs`, configurable) | ✓ | ✓ | ✓ | webview: 等待网页里稍后出现的结果 |

## Device and app

| Detox | Detox platforms | Quiesco | iOS | Android | Web | Verified by |
|---|---|---|---|---|---|---|
| `launchApp({ newInstance })` / `terminateApp` | both | `device.relaunch()` / `terminate()` | ✓ | ✓ | ✓ | lifecycle: 重新启动后数据还在; 结束 App 之后的操作… |
| `launchApp({ launchArgs })`, `appLaunchArgs` | both | `relaunch({ args })` (typed JSON), config `launchArgs`, `quiesco.launchArgs()` in the app | ✓ | ✓ | ✓ | lifecycle: 以启动参数和深链接重新启动 |
| `launchApp({ url })` / `openURL` | both | `relaunch({ url })` (cold start) / `openUrl(url)` | ✓ | ✓ | ✓ | lifecycle: 以启动参数和深链接重新启动 |
| `launchApp({ permissions })` | **iOS** | config `permissions`, `relaunch({ permissions })`, `setPermission(name, 'grant' \| 'revoke' \| 'reset')` while running | ✓ | ✓ | ✓ | permissions (Android / web); device: 运行时撤销定位权限; system: 拒绝 / 允许通知权限 |
| `launchApp({ delete })`, `install` / `uninstall` | both | `relaunch({ reinstall })`, `install()` / `uninstall()` | ✓ | ✓ | — (no install; `reinstall` = clear data) | unit tests (providers) |
| `resetAppState` / `launchApp({ resetAppState })` | both | soft reset before every scenario (storage + `onReset`, < 500 ms), `@hard-reset`, `relaunch({ clearData })` | ✓ | ✓ | ✓ | every scenario; lifecycle: 清除数据后重新启动 |
| `resetContentAndSettings` | **iOS** | **Alternative**: `relaunch({ reinstall: true })` + `setPermission(p, 'reset')` + `clearKeychain()`; device state changed by a scenario is undone automatically | ✓ | ✓ (no keychain) | ✓ | — (documented, see Gaps) |
| `reloadReactNative` (documented as unstable) | both | not offered: `relaunch()` (new process) or the soft reset | ✓ | ✓ | ✓ | — |
| `sendToHome` | both | `sendToBackground()` / `bringToForeground()` (same process) | ✓ | ✓ | ✗ (a page cannot be backgrounded) | lifecycle: 切到后台再回到前台 |
| `setOrientation` | both | `setOrientation` (waits until the window has turned) | ✓ | ✓ | ✓ | device: 横屏 (+ two-column layout) |
| `setLocation` | both | `setLocation(lat, lon)` | ✓ | ✓ (emulators) | ✓ | device: 模拟定位 |
| `languageAndLocale` | **iOS** | `setLocale(tag)` | ✓ | ✓ | ✓ | device: 切换语言 |
| — | — | `setAppearance`, `setFontScale`, `setNetwork`, `clipboard` | ✓ | ✓ | ✓ (no font scale) | device (dark mode, font scale, offline, clipboard) |
| `setURLBlacklist` | both | `sync.ignoreUrls.add()` / config `sync.ignoreUrls` | ✓ | ✓ | ✓ | unit tests (network tracker) |
| `enable/disableSynchronization` (global) | both | `sync.disable()` / `enable()`, per tracker `disableTracker(name)`, `ignoreElements`, `{ sync: false }` per call | ✓ | ✓ | ✓ | lifecycle: 运行时只关闭定时器同步… |
| `sendUserNotification` / `launchApp({ userNotification })` | both | `sendNotification({ title, body, data })`, `openNotification(title)` | ✓ | ✓ | ✗ | system: App 在前台时收到推送, 从通知打开 App |
| `sendUserActivity` / `launchApp({ userActivity })` | **iOS** | **Not offered** (Handoff / Spotlight activities). Links, including universal links: `openUrl` / `relaunch({ url })` | — | — | — | — (see Gaps) |
| `tap` / `longPress` (screen coordinates) | both | `tapAt({ x, y })` / `longPressAt` | ✓ | ✓ | ✓ | actions: 连续点击与按屏幕坐标点击 |
| `takeScreenshot` | both | `device.screenshot()`, full page stitched | ✓ | ✓ | ✓ | screenshots |
| `captureViewHierarchy` | **iOS** | `getTree()` (JSON, semantic types), attached to every failed scenario | ✓ | ✓ | ✓ | unit tests (artifacts) |
| `generateViewHierarchyXml` | both | `getTree()` | ✓ | ✓ | ✓ | unit tests |
| `shake` | **iOS** | `shake()` | ✓ | ✓ | ✗ | system: 摇动设备 |
| biometrics (enrollment, matching / non-matching face or finger) | **iOS** | `biometrics.enroll()` / `match()` / `fail()` | ✓ | ✓ | ✗ | system: 录入生物识别, 生物识别认证成功, 不匹配后… |
| `clearKeychain` | **iOS** | `clearKeychain()` | ✓ | — (no keychain: `relaunch({ clearData })`) | — | unit tests (iOS provider) |
| `setStatusBar` | **iOS** | `setStatusBar({ … })` / `resetStatusBar()` | ✓ | ✓ | — (no status bar) | device: 截图用的状态栏 |
| `reverseTcpPort` | **Android** | `reversePort(port)` (no-op where the device shares the host network) | — | ✓ | — | example config `reversePorts` (every Android run) |
| `pressBack` | **Android** | `pressBack()` | ✗ (no back button) | ✓ | ✓ (browser back) | unit tests (providers) |
| `getUiDevice` (UiAutomator) | **Android** | `device.system.*` (system UI outside the app) | ✓ | ✓ | ✓ (JS dialogs) | system: 拒绝 / 允许通知权限; 取消 / 确定网页的确认对话框 |
| `selectApp` (several apps) | both | **Not offered**: one app per session | — | — | — | — (see Gaps) |

## System UI, WebView, LLM

| Detox | Detox platforms | Quiesco | iOS | Android | Web | Verified by |
|---|---|---|---|---|---|---|
| `system.element(by.system.label)` (experimental) | **iOS** | `device.system.tap` / `expectVisible` / `allowPermission` / `denyPermission` | ✓ (XCUITest runner) | ✓ (uiautomator) | ✓ (JS dialogs) | system: 拒绝通知权限; 取消网页的确认对话框 |
| `web.element(by.web.*)`: tap / typeText / replaceText / runScript / getText | both (several Android issues) | `webview(m).element({ css \| xpath \| id \| text })`: tap / type / replaceText / scrollIntoView / expect* / runScript / url / title | ✓ | ✓ | ✓ (iframe) | webview (6 scenarios) |
| Pilot (LLM-driven steps) | — | planned (Phase 6.14) | — | — | — | — |

## Running tests

| Detox | Quiesco | Verified by |
|---|---|---|
| Jest only | Cucumber (zh / ja / en step libraries), Jest, Vitest | full example suite; `e2e/jest`, `e2e/vitest`; `features-generic` |
| parallel workers | cucumber-js `--parallel`, Jest `maxWorkers`, Vitest `quiesco({ workers })`; a device per worker, created and kept by Quiesco (iOS `simctl create`, Android an AVD copy per worker, so a writable emulator you have open is no obstacle); per-worker config function, ports, artifacts; [parallel.md](parallel.md) | unit tests + three platforms × three runners (Phase 6.12) |
| `retries` | **Alternative**: the runner's own retry (`cucumber-js --retry`, Jest `jest.retryTimes`, Vitest `retry`) | — (runner features) |
| artifacts: screenshots, video, logs, uiHierarchy, instruments | screenshot + element tree + logs on failure, per-scenario video (MP4 / WebM), device log, timeline (Chrome trace) | screenshots; unit tests (artifacts) |
| iOS real devices: not supported (#95) | planned (Phase 6.13) | — |
| Web: no first-party support | Chromium (phone / tablet / desktop viewports) with the same features | every Web run |
| Expo: "community supported" | Expo first: config plugin, dev client, Expo Router, `expo/fetch` | the example app (Expo SDK 58) |

## Detox pain points and what Quiesco does instead

| Pain point (Detox) | Quiesco | Verified (2026-11-11) |
|---|---|---|
| Network sync blind on Expo SDK 56+ Android: only OkHttp is watched, the global `fetch` is `expo/fetch` (#4973) | The agent tracks requests in JS — global `fetch`, `expo/fetch` imported directly (Metro resolver), `XMLHttpRequest`, WebSocket / EventSource handshakes — until the response body has been read | device: 等待 expo/fetch 的慢响应体, 离线时 expo/fetch 也失败, 等待 WebSocket 握手 — iOS / Android / Web, reading the result once without retrying |
| Breaks with React Native releases (bridgeless crash on RN 0.85.3, #4963: reflection on private fields) | Elements are found from React's own tree through the DevTools hook (one file, `fiber-adapter`), not from private native fields; the native module only injects input | the whole suite on React Native 0.88 / Expo SDK 58, bridgeless, three platforms |
| Synchronization all or nothing: endless animations, polling or sockets hang tests; the only way out is turning it off globally (#1513) | Per tracker and per element at runtime (`sync.disableTracker`, `ignoreElements`, `ignoreUrls`), per call `{ sync: false }`; open WebSockets never count, only their handshake | lifecycle: 运行时只关闭定时器同步，并忽略轮询计数; device: 等待 WebSocket 握手 |
| `expect` does not wait; no global timeout (#4885) | Assertions retry until they hold, default `sync.timeoutMs`, per call `timeoutMs` | webview: 等待网页里稍后出现的结果 (and every assertion) |
| iOS keyboard swallows the first tap (#3399); the return key cannot be tapped because of visibility checks (#4546) | A keyboard covering the target is dismissed first and the `native` tracker waits out iOS's touch blackout after keyboard activity; `pressKey('enter')` reaches the field without the keyboard | login / new-todo (type, then tap, on iOS); new-todo: 在标题框按回车也能保存; actions: 键盘按键与替换文本 |
| WebView input unreliable, several Android problems (#4886) | Typing through `execCommand('insertText')` after a real tap; same API on all three platforms | webview: 在网页里输入名字后打招呼, 替换输入框里的文字 — iOS / Android / Web |
| Many capabilities iOS-only (pinch, permissions at launch, biometrics, shake, status bar, locale, system UI, picker columns) | Each is available on iOS and Android, most also on the web (tables above) | gestures, values, device, system |
| `atIndex` order differs between iOS and Android; `toBeVisible` fixed at 75 % | `index` = render order everywhere; visibility = any pixel, `ratio` optional | unit tests (agent query, visibility) |
| `setTimeout` waited only up to 1.5 s, `setInterval` ignored, not configurable | `sync.timerThresholdMs` (default 1500) configurable; busy timers are named in timeout errors | unit tests (timer tracker) |
| Separate test APK, ProGuard rules, framework cache | One e2e build of the app (`EXPO_PUBLIC_QUIESCO=1`) through the config plugin; production builds verified to contain none of it | `scripts/check-prod-strip.mjs` (benchmarks.md) |
| Only Jest; artifacts documentation "to be done" | Cucumber / Jest / Vitest; artifacts documented (api.md, Artifacts) | e2e/jest, e2e/vitest, features |

## Detox platform-only items, availability in Quiesco

Detox items available on one platform only, and on how many platforms Quiesco offers them:

| Item | Detox | Quiesco |
|---|---|---|
| `scrollToIndex` | Android | iOS, Android, Web |
| `setColumnToValue` (picker) | iOS | iOS, Android, Web |
| `pinch` | iOS | iOS, Android, Web (touch) |
| `by.traits` | iOS | `role` / semantic `type`: iOS, Android, Web |
| `launchApp({ permissions })` | iOS | iOS, Android, Web |
| `languageAndLocale` | iOS | iOS, Android, Web |
| `resetContentAndSettings` | iOS | combination of calls on iOS, Android, Web |
| `captureViewHierarchy` | iOS | iOS, Android, Web |
| `shake` | iOS | iOS, Android |
| biometrics | iOS | iOS, Android |
| `setStatusBar` | iOS | iOS, Android (web has none) |
| `system.element` | iOS | iOS, Android, Web (JS dialogs) |
| `pressBack` | Android | Android, Web (iOS has no back button) |
| `getUiDevice` | Android | `device.system`: iOS, Android, Web |
| `clearKeychain` | iOS | **iOS only** — Android and the web have no keychain; `relaunch({ clearData: true })` is the equivalent there |
| `reverseTcpPort` | Android | Android only — iOS simulators and browsers share the host's network, nothing to reverse |
| `sendUserActivity` / `userActivity` | iOS | not offered (Gaps) |

## Gaps

Decided not to build (2026-11-11), with the alternative:

- **`selectApp` (several apps in one test):** one app per session. Test each app in its own run.
- **`sendUserActivity` / `launchApp({ userActivity })`:** Handoff / Spotlight / Siri activities are not
  simulated. Links, including universal links, open through `openUrl` or `relaunch({ url })`.
- **`resetContentAndSettings`:** no whole-simulator erase. `relaunch({ reinstall: true })` removes the
  app and its data, `setPermission(p, 'reset')` returns permissions to "not determined",
  `clearKeychain()` empties the keychain; device state a scenario changed (orientation, appearance,
  locale, location, network, status bar, biometrics) is restored automatically before the next one.
- **`retries`:** the runner's own retry option.
- **`by.traits`:** `{ role }` and the semantic `{ type }`.

Still to come: real devices (6.13), LLM-driven steps (6.14).

## Results

Full example suite, 2026-11-11 (Phase 6.11), dev clients and a development bundle from Metro; iPhone 17
simulator iOS 26.5, Android 17 emulator (API 37), Chromium:

| Platform | Scenarios | Passed | Skipped (tagged for other platforms / needs touch) | Time |
|---|---|---|---|---|
| iOS | 86 | 80 | 6 | 4 m 5 s |
| Android | 86 | 81 | 5 | 6 m 12 s |
| Web (phone viewport) | 86 | 73 | 13 | 1 m 38 s |

Timings against earlier phases: [benchmarks.md](benchmarks.md).
