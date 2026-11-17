<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/logo-dark.svg">
    <img src="docs/logo/logo.svg" alt="Quiesco" height="52">
  </picture>
</h1>

Gray-box end-to-end testing for Expo apps on **iOS, Android and the web**, driven by **Cucumber**,
**Jest**, **Vitest** or any other Node.js test runner.

A small agent inside the e2e build of your app tells the test runner when the app is idle — no pending
network requests, timers, React renders or animations — so tests never sleep and never poll. The same
tests run unchanged on an iOS simulator, an Android emulator and Chromium. Cucumber gets a ready-made
adapter (`@quiesco/cucumber`, below), and so do Jest and Vitest (`@quiesco/jest`, `@quiesco/vitest`,
[other test runners](#other-test-runners-jest-vitest)).

```gherkin
Scenario: A new todo appears at the top of the list
  Given the user "a@example.com" is logged in
  When they add a todo "Buy milk"
  Then the first todo is "Buy milk"
```

```ts
When('they add a todo {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.tap('add-todo');                 // waits until the app is idle, then taps
  await this.app.type('todo-title', title);
  await this.app.tap({ role: 'button', text: 'Save' });
});
```

- **Automatic synchronization** — network, timers, React scheduler, idle callbacks, native transitions
  and a frame-stability fallback ([how it works](https://shift-14cc7601.mintlify.site/sync)). A sync timeout names what was still busy.
- **Real input** — touches and text through `@quiesco/native` (iOS / Android) or Playwright (web); a
  callback mode (`js`) works without native code.
- **Fast resets** — a soft reset (storage, your reset hooks, remount) before every scenario, typically
  ~200 ms; `@hard-reset` relaunches the app.
- **Backdoors** — set up state from steps without driving the UI (`this.app.backdoor('loginAs', …)`).
- **Live progress** — `quiesco test` keeps a progress bar on the last line of the terminal; `quiesco ui`
  runs tests from the browser with a click and shows failures with their screenshot and element tree
  ([test UI](https://shift-14cc7601.mintlify.site/ui)).
- **Nothing in production** — without `EXPO_PUBLIC_QUIESCO=1` the agent is replaced by a no-op stub and
  the native module is excluded from the build (checked in CI, see [benchmarks](https://shift-14cc7601.mintlify.site/benchmarks)).

## Quick start (web, about 10 minutes)

Requirements: Node.js 24+, an Expo app on SDK 55 or later (`npx create-expo-app@latest`).

```sh
cd my-app
npx quiesco init          # dependencies, config plugin, Metro, entry file, quiesco.config.mts, a first feature
```

Then, in your app:

1. Wrap the root layout in `<QuiescoRoot>` (`src/app/_layout.tsx` in the default template):

   ```tsx
   import { QuiescoRoot } from '@quiesco/agent';

   export default function TabLayout() {
     // …
     return (
       <QuiescoRoot>
         <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>…</ThemeProvider>
       </QuiescoRoot>
     );
   }
   ```

2. Give the home screen a test id: `<ThemedView style={styles.container} testID="home">` in
   `src/app/index.tsx`. The generated `features/app.feature` checks that it is visible.

3. The default template spins a decorative glow on the home screen for four minutes, so the screen never
   settles. Give it a test id — `<Animated.View … style={styles.glow} testID="logo-glow">` in
   `src/components/animated-icon.web.tsx` (and `animated-icon.tsx` for iOS / Android) — and uncomment
   `sync: { ignoreElements: ['logo-glow'] }` in `quiesco.config.mts`.

4. Run it:

   ```sh
   npx playwright install chromium
   npm run e2e:web           # exports the web build with EXPO_PUBLIC_QUIESCO=1, then quiesco test --platform web
   ```

   The template renders on the server (`web.output: "server"`); Quiesco runs `npx expo serve` for that
   export by itself. Static exports are served directly.

`npx quiesco doctor` checks the setup and says how to fix what is missing.
`npx quiesco tree` prints the element tree of the running app to find test ids.

### iOS and Android

Native runs need an e2e build of the app (made with `EXPO_PUBLIC_QUIESCO=1`, so it contains the agent
and `@quiesco/native`):

```sh
npx expo install expo-dev-client
npx quiesco build ios       # or: npx quiesco build android
npx quiesco test --platform ios
```

`quiesco build` runs `expo prebuild` with `EXPO_PUBLIC_QUIESCO=1` and the native build, and writes the app
where `binaryPath` in `quiesco.config.mts` says (the generated config has the usual paths). `quiesco test`
starts Metro for the dev client when it is not running, and stops it afterwards. Set the emulator / simulator in `devices` (see [configuration](https://shift-14cc7601.mintlify.site/api#configuration)). For CI, an
EAS build profile with `EXPO_PUBLIC_QUIESCO=1` produces the same e2e build; see
[examples/todo-app](examples/todo-app/README.md) for a complete, tested setup on all three platforms.

## Other test runners (Jest, Vitest)

`@quiesco/vitest` and `@quiesco/jest` do for Vitest and Jest what `@quiesco/cucumber` does for
Cucumber: one session (device and app) for the whole run, a reset before every test, tests tagged for
another platform skipped (`@ios`, `@android`, `@web`, `@native`; the innermost level wins), and a
failure's message lists the evidence files (screenshot, element tree, idle state, logs).

**Vitest** — `app` is a test fixture:

```ts
// vitest.config.ts
import { quiesco, quiescoPlugin } from '@quiesco/vitest/config';
import { defineConfig } from 'vitest/config';
export default defineConfig({ plugins: [quiescoPlugin()], test: { ...quiesco(), include: ['e2e/**/*.test.ts'] } });

// e2e/todo.test.ts
import { test } from '@quiesco/vitest';

test('a new todo appears at the top', async ({ app }) => {
  await app.tap('add-todo');                      // waits until the app is idle, then taps
  await app.type('todo-title', 'Buy milk');
  await app.tap({ role: 'button', text: 'Save' });
  await app.expectText({ id: 'todo-item', index: 0 }, 'Buy milk');
});
test('Android only', { tags: ['@android'] }, async ({ app }) => { /* … */ });
```

`quiesco()` keeps the app across files (`isolate: false`), runs them one at a time (or on N devices with
`quiesco({ workers: N })`) and declares the platform tags; `quiescoPlugin()` sends the progress to
`quiesco test` and `quiesco ui`.

**Jest** — a preset; tests reach the app through the global `quiesco`:

```js
// jest.config.js
module.exports = { preset: '@quiesco/jest', maxWorkers: 1, testTimeout: 120_000 }; // maxWorkers: N = N devices

// e2e/todo.test.js
test('a new todo appears at the top @ios', async () => {
  await quiesco.app.tap('add-todo');
});
```

Platform tags go in test or `describe` titles (Jest has no test options); a config with its own
`reporters` adds `'@quiesco/jest/reporter'` for the progress. Run either with
`npx quiesco test --platform ios --runner vitest|jest`, or from the browser with `quiesco ui`. Both are in
[examples/todo-app/e2e](examples/todo-app/e2e); details in
[using Quiesco without Cucumber](https://shift-14cc7601.mintlify.site/api#using-quiesco-without-cucumber).

## Packages

| Package | What it is |
|---|---|
| [`quiesco`](packages/cli) | CLI: `init`, `build`, `test` (with a progress bar), `ui`, `list`, `doctor`, `tree`, `devices` ([docs](https://shift-14cc7601.mintlify.site/cli)) |
| [`@quiesco/agent`](packages/agent) | In-app agent: element queries, sync trackers, actions, reset, backdoors; `withQuiesco()` for Metro |
| [`@quiesco/native`](packages/native) | Expo module for real touches and text input on iOS / Android (e2e builds only) |
| [`@quiesco/expo-plugin`](packages/expo-plugin) | Config plugin: excludes the native module from production builds, allows the local connection in e2e builds |
| [`@quiesco/core`](packages/core) | Host side: WebSocket server, `Driver` (`this.app`), sessions, iOS / Android device providers. Runner-independent |
| [`@quiesco/cucumber`](packages/cucumber) | cucumber-js World (`this.app`) and lifecycle hooks |
| [`@quiesco/vitest`](packages/vitest) | Vitest: `test` with the `app` fixture, `quiesco()` config, `quiescoPlugin()` |
| [`@quiesco/jest`](packages/jest) | Jest: preset with the Quiesco test environment, global `quiesco` |
| [`@quiesco/web`](packages/web) | Web device provider (Playwright library) |
| [`@quiesco/ui`](packages/ui) | The test UI behind `quiesco ui` (React, served locally) |
| [`@quiesco/steps`](packages/steps/README.md) | Optional generic steps in Chinese, Japanese and English — for prototyping only |
| [`@quiesco/protocol`](packages/protocol) | Types and constants shared by agent and host |

## Documentation

[https://shift-14cc7601.mintlify.site](https://shift-14cc7601.mintlify.site) — in English, [中文](https://shift-14cc7601.mintlify.site/zh) and [日本語](https://shift-14cc7601.mintlify.site/ja).

- [API reference](https://shift-14cc7601.mintlify.site/api) — `this.app` (Driver), matchers, the in-app API, configuration, errors
- [Synchronization](https://shift-14cc7601.mintlify.site/sync) — what "idle" means and how to deal with busy apps
- [Platform differences](https://shift-14cc7601.mintlify.site/platforms) — iOS, Android and web side by side, permissions
- [Driver pattern](https://shift-14cc7601.mintlify.site/driver-pattern) — business-language steps on top of `this.app`
- [Parallel runs](https://shift-14cc7601.mintlify.site/parallel) — a device per worker, cucumber-js / Jest / Vitest
- [Test UI](https://shift-14cc7601.mintlify.site/ui) — run tests from the browser and watch them live
- [CLI](https://shift-14cc7601.mintlify.site/cli)
- [Troubleshooting](https://shift-14cc7601.mintlify.site/troubleshooting) and [known issues](https://shift-14cc7601.mintlify.site/known-issues)
- [Benchmarks](https://shift-14cc7601.mintlify.site/benchmarks)
- [Quiesco and Detox](https://shift-14cc7601.mintlify.site/detox-comparison) — item-by-item comparison with Detox 20.51.4

## Using unreleased changes

`npx quiesco init` installs the packages from npm. To try changes that are not released yet, build
tarballs from this repository and let `quiesco init` install them instead:

```sh
git clone https://github.com/h2nology/quiesco.git && cd quiesco
pnpm install && pnpm build
mkdir -p /tmp/quiesco-packs && pnpm -r --filter "./packages/*" pack --pack-destination /tmp/quiesco-packs
cd /path/to/my-app
node /path/to/quiesco/packages/cli/dist/bin.js init --packages /tmp/quiesco-packs
```

`--packages` installs every Quiesco package from those tarballs and pins their dependencies on each
other to them (npm `overrides`, yarn `resolutions`, pnpm `overrides` in `pnpm-workspace.yaml`).

Developing Quiesco itself, including the documentation site and its translations:
[CONTRIBUTING](CONTRIBUTING.md). Publishing: [releasing](docs/releasing.md). Requirements and design notes:
[requirements.md](requirements.md) (in Chinese).

## License

[MIT](LICENSE)
