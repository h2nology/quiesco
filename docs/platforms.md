# Platform differences

The same features, steps and `this.app` calls run on all three platforms. What differs is underneath:

| | iOS | Android | Web |
|---|---|---|---|
| Device | Simulator (`xcrun simctl`), booted if needed | Emulator or device (`adb`); an AVD is booted cold if needed | Chromium through the Playwright library (a new browser context per launch) |
| App build | `.app` for the simulator, made with `EXPO_PUBLIC_QUIESCO=1` | APK made with `EXPO_PUBLIC_QUIESCO=1` | `npx expo export --platform web` with `EXPO_PUBLIC_QUIESCO=1` (static output served by Quiesco, server output hosted with `npx expo serve`), or a dev server |
| How the app finds the host | launch arguments | intent extras | an init script in the page |
| Real input (`native` mode) | synthesized `UITouch` events (`@quiesco/native`, private API, e2e builds only) | `MotionEvent`s dispatched to the activity (`@quiesco/native`) | Playwright touchscreen (touch viewports) or mouse; text with the keyboard |
| Text input | `insertText` | `InputConnection.commitText` (any language, written at once) | Playwright keyboard |
| Without `@quiesco/native` | `js` mode only (the default then); `openUrl` unavailable | `js` mode only (the default then) | always real input |
| `pressBack()` | not available (`ACTION_NOT_SUPPORTED`) | back key | browser back |
| `tap` at a point, `drag`, `pressKey` (native mode) | needs an app built with `@quiesco/native` ≥ Phase 6.2 (`gesture`, `pressKey`); older builds get `ACTION_NOT_SUPPORTED` with a rebuild hint | same | real input through Playwright |
| `drag` | real touches; iOS 26 also pops a screen on a rightward swipe in its content (turn the screen's back gesture off where content is dragged right) | real touches | mouse drag; text under the pointer must not be selectable (a selection ends the web responder gesture) |
| `openUrl()` | opened inside the app (no system confirmation) | `am start` | navigation |
| Soft reset clears | AsyncStorage + registered adapters | AsyncStorage + registered adapters | `localStorage`, `sessionStorage`, IndexedDB + registered adapters |
| `@hard-reset` | terminate and relaunch | force-stop and relaunch | new browser context (data dropped), reload |
| Screenshot | `simctl io screenshot` | `adb exec-out screencap` | `page.screenshot` |
| Sync trackers | all, plus `native` (UIKit transitions, keyboard) | all except `native` | all except `native` |
| Software keyboard covering a target | dismissed before the touch | dismissed before the touch | — |
| `setValue` on a picker / date picker | wheels turned by a finger (`display="spinner"` for dates; compact / inline: callbacks) | callbacks (dropdowns and date dialogs are separate windows) | `<select>` / date inputs filled by Playwright; other components: callbacks |
| `adjustSlider` | real drag, read back and corrected | real drag, read back and corrected | mouse drag (not read back) |
| `accessibilityAction` | VoiceOver paths (increment / decrement, custom actions) | `performAccessibilityAction` | `onAccessibilityAction` |
| `pinch`, `rotate`, `multiTouch` | several `UITouch`es in one event (needs `@quiesco/native` ≥ Phase 6.4: `multiGesture`) | multi-pointer `MotionEvent`s (same) | CDP touch events on touch viewports; desktop viewports: `ACTION_NOT_SUPPORTED` |
| Recognizer activation compensated (`actions.gestureSlop`) | 9 pt, 7° | 26 dp, 9° | 46 px, 0° |
| `relaunch({ args })` → `quiesco.launchArgs()` | `-quiescoArgs` launch argument (needs `@quiesco/native` ≥ Phase 6.5) | `--es quiescoArgs` extra (same) | init script |
| `relaunch({ url })` | `-quiescoUrl`, handed to expo-linking by `@quiesco/native` before JS runs (≥ Phase 6.5; without it: opened after the launch) | intent data (dev clients: the link with `__expo_url`) | the URL's path is opened (`myapp://todos/1` → `/todos/1`) |
| `relaunch({ clearData })` | data container emptied, UserDefaults deleted; keychain kept | `pm clear` (also revokes permissions; the config's are granted again) | a new browser context |
| `relaunch()` keeps data | yes | yes | cookies, localStorage, IndexedDB carried over (Playwright storage state) |
| `sendToBackground()` | home screen via `-[UIApplication suspend]` (`@quiesco/native` ≥ Phase 6.5), else the Settings app is opened | HOME key | `ACTION_NOT_SUPPORTED` |
| `bringToForeground()` | `simctl launch` (same process) | launcher intent (same task) | — |
| `install()` / `uninstall()` | `simctl install` / `uninstall` | `adb install -r -g` / `uninstall` | no install: `uninstall` is `ACTION_NOT_SUPPORTED`, `relaunch({ reinstall })` acts like `clearData` |
| `reversePort()` | no-op (shares the Mac's network) | `adb reverse` | no-op |
| `setOrientation()` | the window scene is rotated by `@quiesco/native` ≥ Phase 6.6 (simctl cannot rotate) | auto-rotate off, `user_rotation` | viewport sides swapped |
| `setAppearance()` | `simctl ui appearance` | `cmd uimode night` | `emulateMedia({ colorScheme })` |
| `setFontScale()` | `simctl ui content_size`, nearest Dynamic Type size (0.823 … 3.571), live | `settings put system font_scale`, then the app is started again (data kept) | `ACTION_NOT_SUPPORTED` |
| `setLocale()` | relaunch with `-AppleLanguages` / `-AppleLocale` (needs `CFBundleLocalizations`) | per-app language, `cmd locale set-app-locales` (Android 13+), then the app is started again | a new browser context with that locale (data kept) |
| `setLocation()` | `simctl location set` (reset: `clear`) | `adb emu geo fix` (emulators only) | `context.setGeolocation` |
| `setPermission()` | `simctl privacy grant / revoke / reset` (no camera / notifications; their `'reset'` reinstalls the app); the app keeps running | `pm grant / revoke` (+ `clear-permission-flags`); a revoke or reset kills the app → started again | `grantPermissions` / `clearPermissions` |
| `setNetwork('offline')` | the agent fails the app's new connections; no device switch (NetInfo stays online) | the agent, plus `svc wifi / data disable` (NetInfo sees it; `adb reverse` keeps working) | the agent, plus aborted page requests and CDP `Network.overrideNetworkState` (`navigator.onLine`, `offline` / `connection` `change` events; Chromium) |
| `clipboard.set()` / `get()` | `UIPasteboard` in the app (`@quiesco/native` ≥ Phase 6.6); `get` without it: `simctl pbpaste` | `ClipboardManager` in the app (same; without it `ACTION_NOT_SUPPORTED`) | `navigator.clipboard` (clipboard permissions granted to the page) |
| `setStatusBar()` | `simctl status_bar override` (reset: `clear`) | SystemUI demo mode (`sysui_demo_allowed`, notification icons hidden; reset: `exit`) | no status bar: nothing to do |
| `biometrics.enroll()` | `notifyutil` in the simulator: `com.apple.BiometricKit.enrollmentChanged` (restored to the previous value) | screen-lock PIN (`locksettings set-pin`), Settings' enrollment driven with `uiautomator` (buttons by position) and `adb emu finger touch 1`; removing the PIN removes the fingerprint | `ACTION_NOT_SUPPORTED` |
| `biometrics.match()` / `fail()` | `notifyutil -p com.apple.BiometricKit_Sim.pearl.match` / `.nomatch` (and `fingerTouch.*` for Touch ID models) | `adb emu finger touch 1` / `2`, once the authentication has started (`dumpsys fingerprint`) | `ACTION_NOT_SUPPORTED` |
| `shake()` | `notifyutil -p com.apple.UIKit.SimulatorShake` (what *Device > Shake* posts) | `adb emu sensor set acceleration`, 12 alternating pushes | `ACTION_NOT_SUPPORTED` |
| `clearKeychain()` | `simctl keychain reset` (the whole simulator) | `ACTION_NOT_SUPPORTED` | `ACTION_NOT_SUPPORTED` |
| `sendNotification()` | `simctl push` (a simulated APNs push) | posted as the app by `@quiesco/native` ≥ Phase 6.7 (no push service on emulators) | `ACTION_NOT_SUPPORTED` |
| `openNotification()` | the banner, else Notification Center (swiped down), tapped through the XCUITest runner | notification shade (`cmd statusbar expand-notifications`), tapped by `uiautomator` | `ACTION_NOT_SUPPORTED` |
| `system.*` (system UI outside the app) | Quiesco's XCUITest runner (`@quiesco/core/ios-runner`, built once per Xcode version) reading and tapping SpringBoard; permission alerts by button position (no identifiers, localized labels), Face ID's retry alert by its identifiers | `uiautomator dump` (nodes of other packages; ~2 s per dump) + `input tap`; permission buttons by `com.android.permissioncontroller` ids | JavaScript `alert` / `confirm` / `prompt` (held by Playwright's `dialog` event until answered: `OK` / `Cancel`); `beforeunload` always accepted; permission answers: `ACTION_NOT_SUPPORTED` (`setPermission`) |
| `app.webview()` (Phase 6.8) | `@quiesco/native` evaluates scripts in the `WKWebView` (`evaluateJavaScript`, ~50 ms) and adds the page hook as a `WKUserScript` at document start; taps are touches at the element's window position | same with `android.webkit.WebView` (`evaluateJavascript`, 120–375 ms on an emulator) and androidx.webkit `addDocumentStartJavaScript` | the `<iframe>` through Playwright's frames (also cross-origin), picked by position; taps / typing as on the other platforms |
| Value controls, accessibility actions (native mode) | need an app built with `@quiesco/native` ≥ Phase 6.3 (`sliderInfo`, `wheelInfo`, `accessibilityAction`) | same (`sliderInfo`, `accessibilityAction`) | — |

## Permissions

`permissions` in the config are granted before the app launches, so no system dialog interrupts a
scenario. A permission a platform cannot pre-grant is skipped with a warning.

| Quiesco | iOS simulator (`simctl privacy`) | Android (`pm grant`) | Web (`grantPermissions`) |
|---|---|---|---|
| `camera` | — (no simctl service) | `CAMERA` | `camera` |
| `microphone` | `microphone` | `RECORD_AUDIO` | `microphone` |
| `location` | `location` | `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | `geolocation` |
| `notifications` | — (no simctl service) | `POST_NOTIFICATIONS` | `notifications` |
| `contacts` | `contacts` | `READ_CONTACTS` | — |
| `photos` | `photos` | `READ_MEDIA_IMAGES` | — |
| `calendar` | `calendar` | `READ_CALENDAR`, `WRITE_CALENDAR` | — |

- Android grants only permissions the app declares in its manifest (`expo.android.permissions` in
  `app.json`); others are reported as a warning.
- iOS still needs the usage description (`NSLocationWhenInUseUsageDescription`, …) in `Info.plist`
  (`expo.ios.infoPlist`) for the app to request the permission at all.

## iOS

- Quiesco turns off password AutoFill on the simulator (`devices.ios.disablePasswordAutoFill`), otherwise
  iOS covers the app with "Save Password?" after a login form.
- Dev clients are launched with the dev menu, its onboarding, the floating button and its shake gesture
  switched off (a `shake()` would otherwise open the dev menu over the app; the app's own shake handlers
  still get it).
- On iOS 26+ screen content can be laid out under a translucent navigation bar; elements there are
  reported as covered (`ELEMENT_OBSCURED`). Use the header height (`useHeaderHeight()`) or an opaque
  header.
- After keyboard activity iOS ignores touches for a moment; the `native` tracker waits for it.
- Wheel pickers: the column views are private UIKit classes laid out with 3D transforms; Quiesco finds
  where each column takes touches by hit testing along the selection band. A turn waits until the wheel
  stops (UIDatePicker reports its date only then), so a date takes a few seconds.
- iOS 26+ sliders: a short or reversing drag moves the thumb less than the finger; `adjustSlider` drags
  one way with a run-up and corrects from the value read back.
- `relaunch({ url })`: expo-router reads the start URL from expo-linking (`getLinkingURL()`), which
  `@quiesco/native` sets from `-quiescoUrl`. React Native's own `Linking.getInitialURL()` only reads
  launch options and returns `null` for it. The URL is set on the main queue right after the native
  modules are created; in practice that is before the first render.
- In the background iOS suspends the app's JS after a few seconds; element calls fail at once with
  `APP_IN_BACKGROUND` rather than waiting for an answer.
- Clipboard: text put there by another process (`simctl pbcopy`) makes iOS ask the user before the app
  may paste it, and the app's read hangs until someone answers. `clipboard.set()` therefore writes from
  inside the app (`@quiesco/native` ≥ Phase 6.6); the app reads what it wrote itself without asking.
- Biometrics: a failed Face ID / Touch ID attempt leaves the system's retry alert ("Try Face ID again" /
  "Cancel") over the app; the app's `authenticateAsync` resolves only once it is answered, and element
  calls cannot reach the app meanwhile. `match()` does not dismiss it.
- `shake()` uses the Darwin notification Simulator's *Device > Shake* posts; UIKit turns it into a real shake
  motion event (iOS 26 no longer has the private `-[UIApplication _sendMotionEnded:]` Detox used).
- `setNetwork('offline')`: the simulator shares the Mac's network and has no switch of its own. Only the
  agent fails the app's connections (sent to an `.invalid` host, so they fail with React Native's own
  "Network request failed"); NetInfo keeps reporting the Mac's network.

## Android

- Emulators that Quiesco boots start cold (`-no-snapshot-load`, about 14 s): a quick-boot snapshot taken
  before the app was reinstalled makes Android restart about 30 s after booting.
- The app is force-stopped before it is reinstalled (Android 17 otherwise relaunches it without the
  connection parameters).
- `ACCESS_LOCAL_NETWORK` (Android 17) is granted before launch so the app can reach the host.
- Ports the app calls on `localhost` (a mock backend) need `apps.android.reversePorts`.
- `DateTimePicker` and the picker's dialog / dropdown live in separate windows that in-app touches do not
  reach: `setValue` sets them through their callbacks (the date picker by its testID, as it renders no view).
- Accessibility actions are performed after reading the node info, like TalkBack: React Native's delegate
  only handles actions it has listed there.
- A font-scale or language change recreates the activity (React Native's default `configChanges` do not
  include `fontScale` / `locale`). React's root then remounts inside the same JS context, and expo-router
  58's imperative router stops working ("unavailable before the first render has finished") until the
  app restarts. So `setFontScale` / `setLocale` start the app again (data kept), and so does undoing
  them before the next scenario.
- In the background Android pauses React Native's timers and nothing is drawn; the agent counts the
  timer, frame and native trackers as idle while the app is not active.
- Emulators usually have a hardware keyboard, so the software keyboard does not appear while typing.
  To test keyboard-related behavior: `adb shell settings put secure show_ime_with_hard_keyboard 1`.
- `setNetwork('offline')` turns Wi-Fi and mobile data off for the whole emulator; `adb reverse` keeps
  working, so Quiesco, Metro and a mock backend on the host stay reachable — the app's requests to them
  fail through the agent. The previous Wi-Fi / data state is restored before the next scenario.
- adb has no clipboard command: `clipboard.*` needs `@quiesco/native` ≥ Phase 6.6 in the app.
- `biometrics.enroll()` needs an emulator without a screen lock of its own (Quiesco sets PIN 7357 and
  removes it, with the fingerprint, before the next scenario). The app goes to the background while Settings
  enrolls and is brought back. After an unknown finger the sensor is locked for about half a second, longer
  after several failures in a row (the count only resets on a success).
- `setPermission(p, 'revoke')` also clears the permission's user-set / user-fixed flags: after two denials
  Android would stop asking, but a revoked permission is asked for again, as on a fresh install.

## Web

- Chromium is the supported browser; `firefox` / `webkit` can be configured but are not tested.
- Viewports come from the config (phone, tablet, desktop…); touch viewports get touch input.
- A full page load reconnects the agent; the host waits for it without failing the step.
- Testing only native platforms does not require Playwright; the web provider is loaded on demand.
- `setNetwork('offline')` does not use Playwright's `context.setOffline()`: it also stops Quiesco's own
  WebSocket (the socket stays open but no message arrives). Instead the page's requests are aborted
  (routes do not see WebSockets) and CDP `Network.overrideNetworkState` sets `navigator.onLine` with real
  `offline` / `online` events; zero throughput also fires `navigator.connection`'s `change`, the event
  NetInfo listens to in Chromium. A relaunch while offline loads the page first, then goes offline.
- Device-state read-backs never touch the app's own `MediaQueryList`: reading `matches` on the list that
  react-native-web's `Appearance` listens to makes Chromium skip the change event, and
  `useColorScheme()` would never update.
- No background state: a page driven by Playwright stays `visible` whatever is tried (another tab in
  front, a minimized window, CDP lifecycle states, with or without Chromium's background switches).
  Tag background scenarios `@native`.
- `@react-native-community/datetimepicker` has no web implementation; use `<input type="date">` there
  (`setValue` fills it). `@react-native-segmented-control`'s web / Android implementation does not pass
  `testID` on: put the testID on a wrapping `View` (`setValue` uses the single control inside it).
