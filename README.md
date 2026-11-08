# Quiesco

Gray-box end-to-end testing for Expo apps on **iOS, Android and the web**, driven by **Cucumber**.

A small agent inside the e2e build of your app tells the test runner when the app is idle — no pending
network requests, timers, React renders or animations — so steps never sleep and never poll. The same
feature files and step definitions run unchanged on an iOS simulator, an Android emulator and Chromium.

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
  and a frame-stability fallback ([how it works](docs/sync.md)). A sync timeout names what was still busy.
- **Real input** — touches and text through `@quiesco/native` (iOS / Android) or Playwright (web); a
  callback mode (`js`) works without native code.
- **Fast resets** — a soft reset (storage, your reset hooks, remount) before every scenario, typically
  ~200 ms; `@hard-reset` relaunches the app.
- **Backdoors** — set up state from steps without driving the UI (`this.app.backdoor('loginAs', …)`).
- **Nothing in production** — without `EXPO_PUBLIC_QUIESCO=1` the agent is replaced by a no-op stub and
  the native module is excluded from the build (checked in CI, see [benchmarks](docs/benchmarks.md)).

## Quick start (web, about 10 minutes)

Requirements: Node.js 24+, an Expo app on SDK 58 (`npx create-expo-app@latest`).

```sh
cd my-app
npx quiesco init          # dependencies, config plugin, Metro, entry file, quiesco.config.ts, a first feature
```

Then, in your app:

1. Wrap the root layout in `<QuiescoRoot>` (`app/_layout.tsx` with Expo Router):

   ```tsx
   import { QuiescoRoot } from '@quiesco/agent';

   export default function RootLayout() {
     return (
       <QuiescoRoot>
         <Stack />
       </QuiescoRoot>
     );
   }
   ```

2. Give the home screen a test id: `<View testID="home">…`. The generated
   `features/app.feature` checks that it is visible.

3. Run it:

   ```sh
   npx playwright install chromium
   npm run e2e:web           # exports the web build with EXPO_PUBLIC_QUIESCO=1, then quiesco test --platform web
   ```

`npx quiesco doctor` checks the setup and says how to fix what is missing.
`npx quiesco tree` prints the element tree of the running app to find test ids.

### iOS and Android

Native runs need an e2e build of the app (made with `EXPO_PUBLIC_QUIESCO=1`, so it contains the agent
and `@quiesco/native`):

```sh
npx expo install expo-dev-client
EXPO_PUBLIC_QUIESCO=1 npx expo prebuild --clean
# Android: debug APK (dev client)
(cd android && ./gradlew assembleDebug)
# iOS: simulator build (dev client)
xcodebuild -workspace ios/<App>.xcworkspace -scheme <App> -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build build

EXPO_PUBLIC_QUIESCO=1 npx expo start --dev-client   # Metro, in another terminal
npm run e2e:android       # or: npm run e2e:ios
```

Point `binaryPath` in `quiesco.config.ts` at the build (the generated config has the usual paths) and
set the emulator / simulator in `devices` (see [configuration](docs/api.md#configuration)). For CI, an
EAS build profile with `EXPO_PUBLIC_QUIESCO=1` produces the same e2e build; see
[examples/todo-app](examples/todo-app/README.md) for a complete, tested setup on all three platforms.

## Packages

| Package | What it is |
|---|---|
| [`quiesco`](packages/cli) | CLI: `init`, `test`, `doctor`, `tree` ([docs](docs/cli.md)) |
| [`@quiesco/agent`](packages/agent) | In-app agent: element queries, sync trackers, actions, reset, backdoors; `withQuiesco()` for Metro |
| [`@quiesco/native`](packages/native) | Expo module for real touches and text input on iOS / Android (e2e builds only) |
| [`@quiesco/expo-plugin`](packages/expo-plugin) | Config plugin: excludes the native module from production builds, allows the local connection in e2e builds |
| [`@quiesco/core`](packages/core) | Host side: WebSocket server, `Driver` (`this.app`), sessions, iOS / Android device providers. Runner-independent |
| [`@quiesco/cucumber`](packages/cucumber) | cucumber-js World (`this.app`) and lifecycle hooks |
| [`@quiesco/web`](packages/web) | Web device provider (Playwright library) |
| [`@quiesco/steps`](packages/steps/README.md) | Optional generic steps in Chinese, Japanese and English — for prototyping only |
| [`@quiesco/protocol`](packages/protocol) | Types and constants shared by agent and host |

## Documentation

- [API reference](docs/api.md) — `this.app` (Driver), matchers, the in-app API, configuration, errors
- [Synchronization](docs/sync.md) — what "idle" means and how to deal with busy apps
- [Platform differences](docs/platforms.md) — iOS, Android and web side by side, permissions
- [Driver pattern](docs/driver-pattern.md) — business-language steps on top of `this.app`
- [CLI](docs/cli.md)
- [Troubleshooting](docs/troubleshooting.md) and [known issues](docs/known-issues.md)
- [Benchmarks](docs/benchmarks.md)

## Using Quiesco from source

Until the packages are on npm, build tarballs from this repository and let `quiesco init` install them:

```sh
git clone <this repository> quiesco && cd quiesco
pnpm install && pnpm build
mkdir -p /tmp/quiesco-packs && pnpm -r --filter "./packages/*" pack --pack-destination /tmp/quiesco-packs
cd /path/to/my-app
node /path/to/quiesco/packages/cli/dist/bin.js init --packages /tmp/quiesco-packs
```

`--packages` installs every Quiesco package from those tarballs and pins their dependencies on each
other to them (`overrides` / `pnpm.overrides` / `resolutions`).

Developing Quiesco itself: `pnpm run check` runs the build, lint, architecture rules, unit tests and the
example's type check. Requirements and design notes: [requirements.md](requirements.md) (in Chinese).

## License

[MIT](LICENSE)
