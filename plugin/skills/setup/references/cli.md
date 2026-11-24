<!-- Generated from docs/cli.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# CLI

The quiesco command: init, build, test, ui, list, devices, doctor and tree, with every option.
```sh
npx quiesco <command> [options]
```

## `quiesco init` {#quiesco-init}

Sets Quiesco up in an Expo project. Every step reports what it did; existing files are never
overwritten — when a file needs a change Quiesco cannot make safely, it prints what to add. On an app below
Expo SDK 55 it warns (Quiesco supports SDK 55 and later) and sets the project up anyway.

First it asks which test runner to use: Vitest (preselected), Jest or Cucumber ([test runners](../../quiesco-api/references/runners.md)).
`--runner` answers the question beforehand; when nobody is at the terminal (CI), it takes Vitest.

1. Installs the packages with the project's package manager (npm, pnpm, yarn or bun, from the lock file):
   `@quiesco/agent`, `@quiesco/native` as dependencies; `quiesco`, `@quiesco/core`, `@quiesco/expo-plugin`,
   the runner's packages (`@quiesco/vitest` and `vitest`, `@quiesco/jest` and `jest`, or `@quiesco/cucumber`
   and `@cucumber/cucumber`), and `@quiesco/web`, `playwright` for the web as dev dependencies. The Quiesco packages are installed at the version of the CLI that runs `init`
   (`npx quiesco@0.4.0 init` installs 0.4.0), so the scripts it writes match the installed CLI. After the
   install, `init` reads the installed versions back and stops with the install commands to run when one
   differs (for example when the package manager resolved from stale registry metadata).
2. Adds `@quiesco/expo-plugin` to the plugins in `app.json`, and the app IDs it lacks: `ios.bundleIdentifier`,
   `android.package` (both `com.anonymous.<slug>`) and `scheme` (the slug), so the build and
   `quiesco.config.mts` name the same app. Without them, `expo prebuild` picks its own defaults, which differ
   between iOS and Android. With an `app.config.js` / `.ts` it lists them as a step for you instead.
3. Creates `metro.config.js` with `withQuiesco()` (or explains how to wrap an existing one).
4. Makes `@quiesco/agent` the first import of the entry file. Expo Router apps get an `index.ts`
   (`import '@quiesco/agent'; import 'expo-router/entry';`) and `"main": "index.ts"`. When the entry
   registers a local component (`registerRootComponent(App)`, as in the blank templates), `init` also
   wraps that component in `<QuiescoRoot>` there.
5. Writes `quiesco.config.mts` (bundle id, package and scheme taken from `app.json`), the runner's config
   with a first test, and `e2e:*` scripts:

   | Runner | Files |
   |---|---|
   | Vitest | `vitest.config.mts`, `e2e/app.test.ts` |
   | Jest | `jest.config.cjs`, `e2e/app.test.js` |
   | Cucumber | `cucumber.mjs`, `features/support/quiesco.ts`, `features/app.feature` with its step; and `"allowImportingTsExtensions": true` in `tsconfig.json` (step files import each other with `.ts`, see [step files are not compiled](../../writing-tests/references/driver-pattern-cucumber.md#type-stripping)) |

   When the project already has a Vitest or Jest config (its unit tests'), that one stays as it is: Quiesco's
   goes next to it as `vitest.e2e.config.mts` / `jest.e2e.config.cjs`, and the `e2e:*` scripts pass
   `--config` with its name.

| Option | |
|---|---|
| `--platforms ios,android,web` | Platforms to set up. Default: iOS and Android, plus web when `react-native-web` is installed |
| `--runner vitest\|jest\|cucumber` | Test runner to set up, without asking. Default: asked at the terminal (Vitest preselected); Vitest in CI |
| `--packages <dir>` | Install Quiesco from the `.tgz` files in `<dir>` (`pnpm pack` output) and pin their dependencies on each other to them |
| `--skip-install` | Only print the install commands |
| `--upgrade` | Bring a project set up by an older version to this one ([upgrading](#quiesco-init-upgrade)) |
| `--dry-run` | With `--upgrade`: list the changes without making them |

What `init` leaves to you: test ids, and wrapping the root layout in `<QuiescoRoot>` in Expo Router apps (and other entries it cannot change safely); `init` lists what is left.

### Upgrading a project {#quiesco-init-upgrade}

```sh
# or quiesco@0.4.1 for a given version
npx quiesco@latest init --upgrade

# only list the changes
npx quiesco@latest init --upgrade --dry-run
```

Brings a project set up by an older `quiesco init` to the version of the CLI that runs it:

1. Installs every Quiesco package at that version, also ones `init` does not add (such as `@quiesco/steps`),
   and reads the versions back as `init` does. Exact versions (`"quiesco": "0.10.0"`) stay exact; ranges stay
   ranges. The runners themselves (`vitest`, `jest`, `@cucumber/cucumber`)
   and `playwright` are left alone.
2. Removes `paths: ['features/**/*.feature']` from the cucumber config. Older versions wrote it; with it,
   `quiesco test features/x.feature` ran every feature.
3. Adds `"allowImportingTsExtensions": true` to `tsconfig.json`.
4. Writes the app IDs `app.json` lacks (as in step 2 above) and replaces the `// TODO: expo.…` placeholders
   in `quiesco.config.mts` with them.
5. Wraps `registerRootComponent(App)` in `<QuiescoRoot>`. The `e2e:*` scripts are left as they are (one you
   removed stays removed); it names the ones `init` would add.

Each change is listed. What it cannot change safely (`paths` you set yourself, a `tsconfig.json` with
comments, an `app.config.js` / `.ts`) is listed with what to do. Running it again changes nothing. The
platforms come from `quiesco.config.mts` (or `--platforms`). Run `npx quiesco doctor` afterwards.

## `quiesco build` {#quiesco-build}

```sh
npx quiesco build ios
npx quiesco build android --force
npx quiesco build ios --clean
```

Builds the e2e app (`expo prebuild` with `EXPO_PUBLIC_QUIESCO=1`, then `xcodebuild` for the simulator or
`gradlew assembleDebug` / `assembleRelease`) and writes it to `apps.<platform>.binaryPath`. On iOS the
derived data path, configuration and scheme come from that path
(`<dir>/Build/Products/<Configuration>-iphonesimulator/<Name>.app`). A Debug build is skipped when the app
config and the dependencies (with their installed versions) did not change since the last one and the build
is still there; `--force` builds anyway. Release builds embed the JS bundle and are always built.
`--clean` runs `expo prebuild --clean`: `ios/` / `android/` are deleted and generated again, so changes made
by hand in them are lost. Use it after removing a native module or when the native project is in a bad
state; it always builds.

## `quiesco test` {#quiesco-test}

```sh
npx quiesco test --platform web
npx quiesco test --platform android e2e/login.test.ts
npx quiesco test --platform ios --config vitest.e2e.config.mts
npx quiesco test --platform web --runner cucumber --tags @smoke features/login.feature
npx quiesco test --platform web -- --testNamePattern todo
npx quiesco test --help
```

Sets `QUIESCO_PLATFORM` and runs the project's test runner — `vitest run`, `jest` or `cucumber-js`; all
other arguments are passed to it unchanged. Without `--runner vitest|jest|cucumber` it runs the one whose
Quiesco package (`@quiesco/vitest`, `@quiesco/jest`, `@quiesco/cucumber`) is installed; with several or none
installed, `cucumber-js`. Everything after `--` goes to
the runner too, and the `--` itself is dropped, so Quiesco's own option names there belong to the runner
(`quiesco test -- --help` shows the runner's help). `--workers N` runs N workers,
each on a device of its own ([parallel.md](../../quiesco-api/references/parallel.md)): it becomes `--parallel N` for cucumber-js,
`--maxWorkers N` for Jest and `--fileParallelism --maxWorkers N` for Vitest (the runners' own flags work as
well).

On a terminal, a progress bar stays on the last line while the runner's output scrolls above it: done /
total, passed, failed and skipped, the time so far and the test running now (one per device with several
workers). The runner sends it the progress: `quiesco test` adds `@quiesco/cucumber`'s formatter to
cucumber-js by itself, Vitest needs `quiescoPlugin()` and Jest gets it from the preset
([test runners](../../quiesco-api/references/runners.md)); without it, a hint at the end says what to add. `--no-progress` or
`QUIESCO_PROGRESS=0` turns the bar off; it is off in CI and when the output is not a terminal. The exit code
is the runner's.

When the app loads its JS from Metro (`devClient.metroUrl`, or `apps.web.url`) and nothing answers there,
`quiesco test` starts Metro with `EXPO_PUBLIC_QUIESCO=1` (`npx expo start --port <port>`, its output in
`artifacts/metro.log`), waits until it is ready, and stops it when the runner ends, also on Ctrl-C. A Metro
that is already running is used as it is. `devServer` in the config changes the command and the timeout,
or turns this off (`autoStart: false`). Running the runner directly (`npx vitest run`) does not start Metro.

## `quiesco ui` {#quiesco-ui}

```sh
npx quiesco ui --platform web
npx quiesco ui --platform ios --config vitest.e2e.config.mts --port 5173
npx quiesco ui --help
```

Opens the [test UI](https://shift-14cc7601.mintlify.site/ui) in the browser: the project's tests, run all / a file / a test with a click, live
progress, failures with their evidence. Needs `@quiesco/ui` in the project. `--platform`, `--runner`,
`--workers` and the runner's arguments work as for `quiesco test`; `--port N` chooses the port and
`--no-open` does not open the browser. Metro stays up while it runs; Ctrl-C stops it.

## `quiesco list` {#quiesco-list}

```sh
npx quiesco list
npx quiesco list e2e/login.test.ts
npx quiesco list --runner cucumber features/login.feature --json
```

Lists the tests the runner would run (the same runner as `quiesco test`), by file with their lines, without
running them or starting a device. cucumber-js does a dry run with its formats left out (report files stay as they are), Vitest parses the
files, and Jest collects the tests without Quiesco's test environment and the project's global setup (setup
files still run). `--json` prints the list with the test ids the progress bar and the test UI use. The exit
code is 1 when nothing could be listed.

## `quiesco devices` {#quiesco-devices}

```sh
# the simulators / AVDs Quiesco created for parallel workers
npx quiesco devices

# shut them down and delete them
npx quiesco devices --prune
```

Lists `"<name> (Quiesco N)"` simulators and `<avd>_quiesco_N` AVDs (with `[running]` when they are);
`--prune` deletes them. The next parallel run creates them again; your own devices are never touched.

## `quiesco doctor` {#quiesco-doctor}

```sh
# every platform configured in quiesco.config.mts
npx quiesco doctor

npx quiesco doctor --platform ios
```

Checks Node.js, the Expo SDK (55 or later), the project setup (packages, that every Quiesco package has the same version, that
every `quiesco <command>` in the package.json scripts exists, config plugin, `withQuiesco()` in Metro, the agent as the
entry's first import, `<QuiescoRoot>`, the config file), the app IDs (`quiesco.config.mts` against
`app.json` and the builds, and placeholders left by `init`; with an `app.config.js` / `.ts`, against the config
`npx expo config` resolves), settings older versions wrote (`paths` in the
cucumber config; `.ts` imports in step files without `allowImportingTsExtensions`), the platform tools
(simulators, adb and AVDs, the configured Playwright browser), the app builds and the port. Each problem comes with the
fix; most of what an older setup lacks is fixed by `npx quiesco@latest init --upgrade`. Exits with 1 when a
required check fails; warnings and notes (ℹ️, such as a missing `e2e:build:*` script) do not fail.

## Tests in a package of their own {#app-dir}

When the tests are not in the Expo app's directory (a monorepo, or `app/` and `e2e/` side by side), put
`quiesco.config.mts`, the runner and its packages in the test package and point `appDir` at the app,
relative to the config file:

```ts
// e2e/quiesco.config.mts
export default defineConfig({
  appDir: '../app',
  apps: {
    ios: { bundleId: 'com.acme.shop', binaryPath: '../app/ios/build/Build/Products/Debug-iphonesimulator/shop.app' },
  },
});
```

Run the commands in the test package. `doctor` checks the app (Expo, `@quiesco/agent`, the config plugin, Metro,
the entry, `<QuiescoRoot>`, `app.json`) in `appDir` and the test setup (the runner the test package has, the config,
the scripts) where it runs, with the Quiesco packages of both at one version. `build` runs `expo prebuild` and
xcodebuild / gradle in `appDir`; `binaryPath` stays relative to the config file. `init --upgrade` upgrades
`@quiesco/agent`, `@quiesco/native` and `@quiesco/expo-plugin` in the app and the other packages in the test
package. `quiesco test` starts Metro in `appDir`. `--app-dir <dir>` (doctor, build, `init --upgrade`) names the
app without the config.

## `quiesco tree` {#quiesco-tree}

```sh
# attach to the running app
npx quiesco tree

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
