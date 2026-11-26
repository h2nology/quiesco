---
name: setup
description: This skill should be used when the user runs /quiesco:setup or asks to "set up Quiesco", "add Quiesco to my Expo app", "install Quiesco", "get e2e tests running with Quiesco", "quiesco doctor fails", "fix my Quiesco setup", or "add iOS / Android to Quiesco". Sets Quiesco up in an Expo project (init, QuiescoRoot, testIDs, platform tools, native builds), loops on `quiesco doctor` until it passes, and runs the first feature.
argument-hint: "[web] [ios] [android]"
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, AskUserQuestion
---

# Set up Quiesco in an Expo project

Take an Expo app from nothing (or a broken setup) to a passing first scenario. Work in the user's project
directory; run commands with the project's package manager (detect it from the lock file).

## 1. Inspect the project

- Confirm it is an Expo app: `app.json` / `app.config.*` and `expo` in `package.json`. Quiesco needs
  Node.js 24+ and supports Expo SDK 58. Node below 24 is a blocker; another SDK version is not —
  tell the user it is untested and ask whether to continue.
- Note the router (Expo Router: `app/` or `src/app/` with `_layout.tsx`; otherwise the entry's
  `registerRootComponent`) and whether `react-native-web` is installed.
- If `quiesco.config.*` already exists, the project is set up: skip to step 5 (doctor) and treat the task
  as repair. When adding a platform to an existing setup, do only that platform's part of steps 3–4.

## 2. Choose the platforms

Platforms requested in `$ARGUMENTS` (`web`, `ios`, `android`) are the answer. Otherwise ask with
AskUserQuestion (multi-select), noting:

- **web** — about 10 minutes, needs only Playwright's Chromium; the fastest way to a first green run.
- **ios** — macOS with Xcode and a simulator; needs an e2e build (`quiesco build ios`, several minutes).
- **android** — Android SDK with an AVD or device; needs an e2e build (`quiesco build android`).

Web needs `react-native-web`; offer `npx expo install react-native-web react-dom` when it is missing.

## 3. Run init and finish what it leaves

```sh
npx quiesco init --platforms web,ios --runner vitest   # the chosen platforms, comma-separated
```

Pass `--runner` (`vitest`, the recommended default; `jest`; or `cucumber`, which the user picks when they want
Gherkin features): without it `init` asks at the terminal, which a non-interactive shell cannot answer (it
then takes Vitest). `init` installs the packages, adds the config plugin, `withQuiesco()` in
`metro.config.js`, the agent as the entry's first import, `quiesco.config.mts`, the runner's config with a
first test (`e2e/app.test.ts` for Vitest, `features/app.feature` for Cucumber) and `e2e:*` scripts. It
never overwrites files; it prints what it could not change. Read its output and do each remaining item:

- **`<QuiescoRoot>`** — in Expo Router apps wrap the root layout's returned tree
  (`import { QuiescoRoot } from '@quiesco/agent'`). The agent connects from it; without it the app
  never connects.
- **An existing `metro.config.js`** — wrap its export:
  `const { withQuiesco } = require('@quiesco/agent/metro'); module.exports = withQuiesco(config);`
- **The first test's testID** — open the generated test (`e2e/app.test.ts`, or `features/app.feature`) to see which
  testID it expects, and put that `testID` on the home screen's root view.

Tell the user which app files were edited. Edit only what Quiesco needs.

## 4. Platform tools and builds

- **web:** `npx playwright install chromium`.
- **ios / android:** `npx expo install expo-dev-client` if missing, then `npx quiesco build ios` /
  `npx quiesco build android`. Builds take minutes: run them with `run_in_background`; meanwhile run
  doctor only for the other platforms (`--platform web`) or ignore its app-build check. Set `devices.ios.device` / `devices.android.avd` in `quiesco.config.mts` when doctor
  reports no simulator / AVD (list them with `xcrun simctl list devices available` /
  `emulator -list-avds`), asking the user when several fit.

## 5. Doctor loop

```sh
npx quiesco doctor                 # or --platform <p> to check one
```

Each failed check prints its fix. Apply the fixes, run doctor again, and repeat until it exits 0
(warnings do not fail). A missing app build while `quiesco build` is still running does not count as a
round. Stop after three rounds without progress and report the remaining checks with
their output instead of guessing. Mixed Quiesco versions: install every `quiesco` / `@quiesco/*` package
at the same exact version in one command.

## 6. First run

Run the generated script for one platform with the project's package manager (`pnpm e2e:web`,
`yarn e2e:web`, …), web first when chosen:

```sh
npm run e2e:web                    # exports the web build with EXPO_PUBLIC_QUIESCO=1, then quiesco test
npm run e2e:ios                    # quiesco test --platform ios; starts Metro for the dev client by itself
npm run e2e:android
```

Known first-run failures:

- **`SYNC_TIMEOUT` with `frame-stable` busy** — an endless decorative animation (the default template's
  spinning glow on the home screen). Give that element a testID and add it to
  `sync: { ignoreElements: ['<testID>'] }` in `quiesco.config.mts` (the generated config has the line
  commented out).
- **`CONNECT_TIMEOUT`** — not an e2e build (`EXPO_PUBLIC_QUIESCO=1` missing at bundle or prebuild time),
  `<QuiescoRoot>` not rendered, or Metro started before `withQuiesco()` was added (restart it).
- Anything else: follow the `/quiesco:debug` workflow, using
  `${CLAUDE_PLUGIN_ROOT}/skills/debug/references/troubleshooting.md`.

## 7. Report

Summarize: platforms set up, files created and edited (separating app code from test setup), the first
run's result, and next steps — write real scenarios (the `writing-tests` skill), `npx quiesco tree` to find
testIDs, `npx quiesco ui` for the browser test UI, and `/quiesco:eas` to build the app and run the native tests on
EAS.

## Additional resources

- **`references/quickstart.md`** — the quick start, step by step: web, iOS and Android (dev client,
  builds, devices).
- **`references/cli.md`** — every CLI command and option (`init`, `build`, `test`, `ui`, `list`,
  `devices`, `doctor`, `tree`).
- **`${CLAUDE_PLUGIN_ROOT}/skills/quiesco-api/references/config.md`** — every configuration option.
