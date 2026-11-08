# Quiesco example: todo app

Expo SDK 58 + Expo Router app used to accept Quiesco (requirements.md §9): login, todo list, new-todo
form, animated screen transitions, and network calls to a local mock backend.

## Run the e2e tests on Android (dev client)

```sh
# once: build and (re)install the dev client APK
pnpm build:android

# terminal 1: Metro in e2e mode (EXPO_PUBLIC_QUIESCO=1 keeps the real agent in the bundle)
pnpm start:e2e

# terminal 2: run the features (an emulator must be running, or set QUIESCO_AVD to boot one)
pnpm test:e2e:android
```

## Run the e2e tests on iOS (simulator, dev client)

```sh
# once: prebuild with EXPO_PUBLIC_QUIESCO=1 and build the simulator dev client (.app)
pnpm build:ios

# terminal 1: Metro in e2e mode
pnpm start:e2e

# terminal 2: run the features on the booted simulator (or pick one with QUIESCO_IOS_DEVICE / QUIESCO_IOS_OS)
pnpm test:e2e:ios
```

The simulator shares the Mac's network, so Metro and the mock backend need no port forwarding. Quiesco
installs the `.app`, launches it with the expo-dev-menu switched off (no menu, onboarding or floating
button) and turns off password AutoFill on the simulator (`devices.ios.disablePasswordAutoFill`), so
iOS's "Save Password?" sheet never covers the app after the login form.

## Run in parallel (`--parallel 2`)

```sh
pnpm test:e2e:web:parallel
pnpm test:e2e:ios:parallel                       # Metro running (pnpm start:e2e)
QUIESCO_AVD=Medium_Phone_API_37.0 pnpm test:e2e:android:parallel
```

Every cucumber worker gets its own Quiesco port (7357 + N), its own device and its own mock backend
(3001 + N). Because `quiesco.config.mts` is a function of `workerIndex`, Android forwards `3001 + N`
with `adb reverse`; the app picks the backend port from `quiesco.workerIndex()` (`src/e2e.ts`).

- **iOS**: worker 0 uses the chosen simulator; worker N uses `"<name> (Quiesco N)"` (same device type
  and runtime), created with `simctl create` on first use and kept for later runs. Remove them with
  `xcrun simctl delete "iPhone 17 (Quiesco 1)"`. `devices.ios.udids` assigns simulators explicitly.
- **Android**: with `QUIESCO_AVD`, worker N uses that AVD's emulator on console port 5554 + 2N
  (`emulator-5554`, `emulator-5556`, ...) and boots it if needed. The emulator runs one AVD several
  times only when **every** instance is `-read-only`, so all worker instances start that way: nothing
  they change is kept after they exit (the app is installed again on every run anyway). If a writable
  instance of the AVD is already running (e.g. started from Android Studio), Quiesco stops with the
  `adb -s <serial> emu kill` command to close it. Emulators boot cold (`-no-snapshot-load`, about 14 s):
  a quick-boot snapshot goes stale once the app is reinstalled and makes Android restart after boot.
  Without `QUIESCO_AVD`, worker N uses the N-th connected device; `devices.android.serials` assigns
  devices explicitly.
- **Web**: every worker launches its own browser and static server; nothing to set up.

## EAS builds for e2e

`eas.json` has an `e2e` profile (JS bundled in, `EXPO_PUBLIC_QUIESCO=1`, iOS simulator build, Android
APK) for CI, and `e2e-dev` (the same as a dev client). Point `apps.ios.binaryPath` /
`apps.android.binaryPath` at the downloaded build; drop `devClient` for the bundled `e2e` build.

```sh
eas build --profile e2e --platform ios
eas build --profile e2e --platform android
```

The mock backend is started by `features/support/mock-server.ts`. Knobs for robustness checks:

| Variable | Effect |
|---|---|
| `MOCK_DELAY_MS=2000` | every backend response takes 2 s |
| `MOCK_STALL="POST /login"` | that route never answers (to see a sync-timeout report) |
| `EXPO_PUBLIC_TRANSITION_MS=1000` | screen transitions take 1 s (set when starting Metro) |
| `QUIESCO_AVD=<name>` | AVD to use / boot |
| `QUIESCO_IOS_DEVICE="iPhone 17"`, `QUIESCO_IOS_OS=27.0` | simulator to use / boot (default: the booted one) |
| `QUIESCO_ACTION_MODE=js` | call component callbacks instead of injecting real touches |

Actions use the `native` mode (real touches and IME text through `@quiesco/native`) because the app
includes the native module; `QUIESCO_ACTION_MODE=js` switches to callback mode.

## Benchmark

```sh
pnpm bench:android        # 20 iterations: soft reset, tap incl. sync, full suite (native and js)
```

The output is a Markdown section for `docs/benchmarks.md`.

## How the app integrates Quiesco

- `index.ts` imports `@quiesco/agent` before `expo-router/entry`.
- `src/app/_layout.tsx` wraps the app in `<QuiescoRoot>` and loads `src/e2e.ts` (backdoors, reset hook)
  only when `EXPO_PUBLIC_QUIESCO=1`.
- `metro.config.js` wraps the config with `withQuiesco()`: production bundles get a no-op stub.
- `app.json` lists `@quiesco/expo-plugin`: without `EXPO_PUBLIC_QUIESCO=1` at prebuild time it excludes
  `@quiesco/native` from autolinking (Podfile and settings.gradle), so production binaries do not contain
  the touch injection code; e2e builds keep it and allow ws://localhost (Android network security config,
  iOS ATS `NSAllowsLocalNetworking`).
- Step definitions (`features/step_definitions`) only call `this.app`; they never wait or sleep.
