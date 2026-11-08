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

## Serial only

Quiesco drives one device per run, so `cucumber-js --parallel` is refused with a clear error. Emulators
that Quiesco boots itself (`QUIESCO_AVD`) start writable and cold (`-no-snapshot-load`, about 14 s): a
quick-boot snapshot goes stale once the app is reinstalled and makes Android restart after boot.

Simulators named `"<name> (Quiesco N)"` were created by an earlier version for parallel workers and are
no longer used; remove them with `xcrun simctl delete "iPhone 17 (Quiesco 1)"`.

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

## Production-strip check

```sh
pnpm check:prod-strip --platform web                      # from the repository root
pnpm check:prod-strip --platform android --allow-clean    # deletes android/: run `pnpm build:android` afterwards
pnpm check:prod-strip --platform ios --allow-clean        # deletes ios/: run `pnpm build:ios` afterwards
```

`scripts/check-prod-strip.mjs` builds this app without and with `EXPO_PUBLIC_QUIESCO=1` (Web export,
Android release APK with R8, iOS Release simulator build) and scans the artifacts: the production build
must contain no agent JS and no `@quiesco/native` code, the e2e build must contain every marker (control
group, so a marker that stops matching is noticed). `prebuild --clean` must run in this directory, which
is why `--allow-clean` is required when `android/` / `ios/` exist. CI runs it in `prod-strip.yml`.

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
