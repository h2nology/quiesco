# Troubleshooting

Start with `npx quiesco doctor`: it checks the tools and the project setup and says how to fix each
problem. Below are the failures it cannot see, by symptom.

## The app does not connect (`CONNECT_TIMEOUT`)

The message lists what to check. Most often:

- **The app is not an e2e build.** The JS bundle and the native app must both be built with
  `EXPO_PUBLIC_QUIESCO=1` (Metro: `EXPO_PUBLIC_QUIESCO=1 npx expo start`; native: the variable must be
  set at `expo prebuild` too). Without it the agent is the no-op stub.
- **`metro.config.js` does not use `withQuiesco()`**, or Metro was started before you added it (the
  Metro config is read at start-up: restart Metro).
- **Android:** the host port is forwarded with `adb reverse` automatically; a physical device also needs
  USB debugging authorized. Ports your app calls on `localhost` need `apps.android.reversePorts`.
- **A dev client shows its launcher instead of the app:** Metro is not running at `devClient.metroUrl`.

## No element is found, in every scenario

`No React renderer registered with the Quiesco DevTools hook` in the app log means the agent was set up
after React Native's renderer. `withQuiesco()` in `metro.config.js` runs the agent's hook before React
Native starts; make sure it wraps the config (in release / EAS builds too) and that `@quiesco/agent` is
the first import of the entry file.

## The app shows old code

Metro without Watchman can miss file changes (after `git checkout`, or files written by scripts) and
keep serving the old bundle. Restart Metro with `--clear`, or install Watchman. For Android release
builds, Gradle does not notice changes in workspace packages: delete
`android/app/build/generated/assets/react/release` before building.

## `SYNC_TIMEOUT`

The app never became idle; the error lists every busy tracker. See
[synchronization](sync.md#when-the-app-never-becomes-idle) for each case (endless requests, timer loops,
animations). For a screen with an endless animation, pass `{ sync: false }` to that step's calls.

If the frame-stable line says very few frames were sampled in the time waited, the device was starved
(an emulator on an overloaded machine), not animating. Close other simulators / emulators.

## `ELEMENT_OBSCURED`

A real touch would hit something else. The error names it (`obscuredBy`; on iOS the native hit chain).
Typical causes: a dialog or sheet still open, a toast, content under a translucent navigation bar
(iOS 26+), an element still animating into place. A software keyboard over the target is dismissed
automatically.

## "… isn't responding" on Android (parallel runs)

Quiesco warns `Android showed "com.android.systemui isn't responding" over the app; Quiesco chose Wait`:
the machine runs more devices than it can carry (each worker is a full emulator). Quiesco answers these
dialogs so the run goes on, but run fewer workers (`--workers`, [parallel.md](parallel.md)). When the
dialog is for **your app** (`<package> itself isn't responding`), Quiesco leaves it: the app hung.

## A scenario passes alone but fails in parallel runs

Workers run their own share of the scenarios in their own order, each on a fresh device. A scenario that
relied on an earlier one (a permission granted, data left behind) has to set that up in its own `Given`
steps. On iOS, `sendNotification` reports "may not show notifications" when the app was never allowed to
on that simulator.

## `AGENT_TIMEOUT`

The agent did not answer: the app's JS thread is blocked by a long synchronous task, or the app crashed.
Check the app log (forwarded at `logLevel`) and the device log.

## `APP_ERROR`

An uncaught error in the app fails the current step — it is usually a real bug. Known harmless framework
reports can be ignored with `appErrors.ignore` (see [known issues](known-issues.md)).

## iOS

- **"Save Password?" covers the app** after a login form: keep `devices.ios.disablePasswordAutoFill`
  enabled (the default).
- **`simctl` cannot find the simulator:** set `devices.ios.device` (and `os` when several runtimes have
  that device), or boot one.
- **Camera / notifications are not granted:** the simulator cannot pre-grant them (see
  [permissions](platforms.md#permissions)); avoid the system dialog in tests, or accept it in a step.

## Android

- **The emulator restarts about 30 s after booting:** a stale quick-boot snapshot. Quiesco cold-boots the
  emulators it starts; an emulator you started from Android Studio may still load a snapshot — use
  "Cold Boot Now" once.
- **"Activity class does not exist" right after boot:** the user was not unlocked yet; Quiesco waits for
  it, but a device stuck in that state needs `adb reboot`.
- **A permission is not granted:** Android grants only permissions declared in the manifest
  (`expo.android.permissions`).
- **No software keyboard appears:** emulators usually have a hardware keyboard. See
  [platform differences](platforms.md#android).

## Web

- **`@quiesco/web` / Playwright not found:** `npm i -D @quiesco/web playwright` and
  `npx playwright install chromium`. Native-only projects do not need them.
- **The first navigation to a lazy route fails with "Requiring unknown module":** a benign Expo Router
  report that Quiesco ignores by default ([known issues](known-issues.md)).

## Still stuck

`npx quiesco tree` shows what the agent sees; `this.app.getIdleState()` shows what is busy right now.
Failed scenarios carry a screenshot, the element tree and the tracker states in the cucumber report.
