<!-- Generated from docs/known-issues.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Known issues

Problems in Expo, React Native or the platforms that Quiesco works around or cannot fix.
## Web: "Requiring unknown module" reported as fatal on the first navigation to a lazy route {#web-requiring-unknown-module-reported-as-fatal-on-the-first-navigation-to-a-lazy-route}

- Seen with: Expo SDK 58, Expo Router static output (`web.output: "static"`), production web export.
- What happens: on the first navigation to a route whose chunk is not loaded yet, Expo Router's async
  require first tries a synchronous `require` of the route module. Metro's guarded module loader does
  not throw on the missing module; it calls `ErrorUtils.reportFatalError(...)`. Expo then loads the
  chunk and the navigation completes normally.
- Real users hit it too: it is reported silently in production (verified: a plain Playwright UI login
  without Quiesco reaches `/todos`, and a wrapped `ErrorUtils` global handler records
  `FATAL: Requiring unknown module "818".`).
- Quiesco: app errors fail the current step (requirements.md §7), so this report would fail the first
  scenario that navigates. `DEFAULT_IGNORED_APP_ERRORS` in `@quiesco/core` ignores it (logged as a
  warning instead). Turn the defaults off with `appErrors: { ignoreDefaults: false }`; add your own
  patterns with `appErrors: { ignore: [...] }`. A genuinely missing module still fails the scenario
  through the following assertions.

## iOS: "Save Password?" sheet covers the app after a login form {#ios-save-password-sheet-covers-the-app-after-a-login-form}

- Seen with: iOS 26.5 / 27.0 simulators, any form with a `secureTextEntry` field that disappears after
  submitting (e.g. login, then navigation).
- What happens: iOS shows the Passwords "Save Password?" sheet in a system window above the app. Every
  touch is obscured (Quiesco reports `ELEMENT_OBSCURED`, the touch would reach a `UIView` in
  `UITextEffectsWindow`), and no app reset dismisses it, so the following scenarios fail too.
  `textContentType="none"` / `autoComplete="off"` on the fields do not prevent it.
- Quiesco: the iOS provider turns off password AutoFill on the simulator at boot (the configuration
  profile restriction `allowPasswordAutoFill`, as MDM does; takes effect without a reboot). Opt out
  with `devices.ios.disablePasswordAutoFill: false`.

## iOS 26+: screen content laid out under the navigation bar {#ios-26-screen-content-laid-out-under-the-navigation-bar}

- Seen with: react-native-screens 4.30 (Expo SDK 58) on iOS 26+: screens always extend under the
  navigation bar (`edgesForExtendedLayout = UIRectEdgeAll`). In this setup the screen's own top inset
  only covered the status bar, so the top of the content sat under the bar — real users cannot tap it
  either, and Quiesco reports `ELEMENT_OBSCURED` (`the touch would reach NavigationBarContentView`).
- The example app uses a transparent header on every platform and pads each screen with
  `useHeaderHeight()` (`expo-router/react-navigation`), so the layout is the same on iOS, Android and web.

## iOS: touches right after keyboard activity are dropped {#ios-touches-right-after-keyboard-activity-are-dropped}

- Seen with: iOS 27 simulator. A touch outside the keyboard 0 ms after typing (or while the keyboard
  appears / changes height) never reaches the app; 300 ms later it does.
- Quiesco: `@quiesco/native` tracks keyboard notifications and typing; touches wait until the
  keyboard has been quiet for 400 ms (`settling`), and the `native` idle tracker makes every sync wait
  for it. Only steps right after typing pay the wait.

## Expo SDK 55–56, Android: element rects a status bar's height too high {#expo-sdk-55-56-android-element-rects-a-status-bars-height-too-high}

- Seen with: React Native 0.83 / 0.85 (Expo SDK 55 / 56), edge-to-edge apps (the default).
- What happens: `getBoundingClientRect` adds React Native's viewport offset, which these versions take as
  the root view's position minus the visible display frame, so every rect is the status bar's height
  above the view on screen. React Native 0.86 measures from the window in edge-to-edge apps.
- Quiesco: before each call the agent compares one view's rect with its position in the window (from
  `@quiesco/native`) and corrects every rect by the difference: `attributes().rect`, `tapAt`, element
  screenshots and visibility agree with what is on screen on every SDK. Without `@quiesco/native` (js
  actions) rects stay as React Native reports them.

## Expo SDK 55–57 on Xcode 27 / iOS 27 {#expo-sdk-55-57-on-xcode-27-ios-27}

- Building: some pods and resource bundles of these SDKs declare iOS 9–13.4, which Xcode 27 rejects;
  raise them in a Podfile `post_install`. On SDK 55, expo-router also uses an iOS 16 API without an
  availability check: raise the app's deployment target to 16.0 (`expo-build-properties`:
  `ios.deploymentTarget`).
- Running: apps on these SDKs are terminated at launch on iOS 27 (they do not adopt the UIScene life
  cycle, which iOS 27 requires). Test them on an iOS 26 simulator (`devices.ios.os`).
- Neither involves Quiesco; `@quiesco/native` itself needs iOS 15.1.
