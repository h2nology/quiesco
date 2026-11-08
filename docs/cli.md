# CLI (`quiesco`)

```sh
npx quiesco <command> [options]
```

## `quiesco init`

Sets Quiesco up in an Expo project. Every step reports what it did; existing files are never
overwritten — when a file needs a change Quiesco cannot make safely, it prints what to add.

1. Installs the packages with the project's package manager (npm, pnpm, yarn or bun, from the lock file):
   `@quiesco/agent`, `@quiesco/native` as dependencies; `quiesco`, `@quiesco/core`, `@quiesco/cucumber`,
   `@quiesco/expo-plugin`, `@cucumber/cucumber` (and `@quiesco/web`, `playwright` for the web) as dev
   dependencies.
2. Adds `@quiesco/expo-plugin` to the plugins in `app.json`.
3. Creates `metro.config.js` with `withQuiesco()` (or explains how to wrap an existing one).
4. Makes `@quiesco/agent` the first import of the entry file. Expo Router apps get an `index.ts`
   (`import '@quiesco/agent'; import 'expo-router/entry';`) and `"main": "index.ts"`.
5. Writes `quiesco.config.ts` (bundle id, package and scheme taken from `app.json`), `cucumber.mjs`,
   `features/support/quiesco.ts`, a first feature with its step, and `e2e:*` scripts.

| Option | |
|---|---|
| `--platforms ios,android,web` | Platforms to set up. Default: iOS and Android, plus web when `react-native-web` is installed |
| `--packages <dir>` | Install Quiesco from the `.tgz` files in `<dir>` (`pnpm pack` output) and pin their dependencies on each other to them |
| `--skip-install` | Only print the install commands |

What `init` leaves to you: wrapping the root in `<QuiescoRoot>`, test ids, and building the iOS / Android
e2e apps.

## `quiesco test`

```sh
npx quiesco test --platform web
npx quiesco test --platform android --tags @smoke features/login.feature
```

Sets `QUIESCO_PLATFORM` and runs the project's `cucumber-js`; all other arguments are passed to it
unchanged. `--parallel` is refused: Quiesco drives one device at a time.

## `quiesco doctor`

```sh
npx quiesco doctor                 # every platform configured in quiesco.config.ts
npx quiesco doctor --platform ios
```

Checks Node.js, the project setup (packages, config plugin, `withQuiesco()` in Metro, the agent as the
entry's first import, `<QuiescoRoot>`, the config file), the platform tools (simulators, adb and AVDs,
Playwright's Chromium), the app builds and the port. Each problem comes with the fix. Exits with 1 when a
required check fails; warnings do not fail.

## `quiesco tree`

```sh
npx quiesco tree                   # attach to the running app
npx quiesco tree --launch --platform android
npx quiesco tree --json > tree.json
```

Prints the element tree of the screen the app shows — type, `#testID`, text and `[role]` per element —
to find the matchers for your steps:

```
RCTView #todos-screen
  RCTText #greeting "a@example.com"
  RCTScrollView #todo-list
    RCTText #todo-empty "No todos yet"
  RCTView #add-todo [button]
    RCTText "New"
```

By default it starts only the host server and waits for the app that is already running (an e2e build
started by hand, or left by a test run, reconnects within a few seconds), so you see the screen you
navigated to. `--launch` boots the device and launches the app first, like a test run. `--timeout <ms>`
sets how long to wait for the app.
