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
| `@hard-reset` | terminate and relaunch | force-stop and relaunch | new browser context, reload |
| Screenshot | `simctl io screenshot` | `adb exec-out screencap` | `page.screenshot` |
| Sync trackers | all, plus `native` (UIKit transitions, keyboard) | all except `native` | all except `native` |
| Software keyboard covering a target | dismissed before the touch | dismissed before the touch | — |

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
- Dev clients are launched with the dev menu, its onboarding and the floating button switched off.
- On iOS 26+ screen content can be laid out under a translucent navigation bar; elements there are
  reported as covered (`ELEMENT_OBSCURED`). Use the header height (`useHeaderHeight()`) or an opaque
  header.
- After keyboard activity iOS ignores touches for a moment; the `native` tracker waits for it.

## Android

- Emulators that Quiesco boots start cold (`-no-snapshot-load`, about 14 s): a quick-boot snapshot taken
  before the app was reinstalled makes Android restart about 30 s after booting.
- The app is force-stopped before it is reinstalled (Android 17 otherwise relaunches it without the
  connection parameters).
- `ACCESS_LOCAL_NETWORK` (Android 17) is granted before launch so the app can reach the host.
- Ports the app calls on `localhost` (a mock backend) need `apps.android.reversePorts`.
- Emulators usually have a hardware keyboard, so the software keyboard does not appear while typing.
  To test keyboard-related behavior: `adb shell settings put secure show_ime_with_hard_keyboard 1`.

## Web

- Chromium is the supported browser; `firefox` / `webkit` can be configured but are not tested.
- Viewports come from the config (phone, tablet, desktop…); touch viewports get touch input.
- A full page load reconnects the agent; the host waits for it without failing the step.
- Testing only native platforms does not require Playwright; the web provider is loaded on demand.
