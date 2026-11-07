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

The mock backend is started by `features/support/mock-server.ts`. Knobs for robustness checks:

| Variable | Effect |
|---|---|
| `MOCK_DELAY_MS=2000` | every backend response takes 2 s |
| `MOCK_STALL="POST /login"` | that route never answers (to see a sync-timeout report) |
| `EXPO_PUBLIC_TRANSITION_MS=1000` | screen transitions take 1 s (set when starting Metro) |
| `QUIESCO_AVD=<name>` | AVD to use / boot |
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
- `app.json` lists the `@quiesco/native` config plugin: without `EXPO_PUBLIC_QUIESCO=1` at prebuild time
  the native module is excluded from autolinking, so production binaries do not contain it.
- Step definitions (`features/step_definitions`) only call `this.app`; they never wait or sleep.
