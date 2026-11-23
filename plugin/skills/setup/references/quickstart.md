<!-- Generated from docs/quickstart.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Quick start

From a new Expo app to a passing test on the web, iOS and Android.
Requirements: Node.js 24+, an Expo app on SDK 55 or later (`npx create-expo-app@latest`). For each platform
you want to test:

| Platform | What you need |
|---|---|
| Web | Nothing else: Playwright downloads Chromium in the last step |
| iOS | A Mac with Xcode and an iOS simulator |
| Android | The Android SDK (Android Studio) and an emulator (AVD) |

The first four steps are the same for every platform; the last one runs the tests on the platform you
choose.

### Step 1: Set up the project

```sh
cd my-app

# dependencies, config plugin, Metro, entry file, quiesco.config.mts, a first test
npx quiesco init
```

`init` asks which test runner to use: press Enter for Vitest (recommended), or choose Jest or Cucumber
([test runners](../../quiesco-api/references/runners.md)). `--runner vitest|jest|cucumber` chooses without the question. The steps
below use Vitest; with the others only the file names differ.

`init` sets up iOS, Android and, when the app has `react-native-web`, the web; `--platforms web,ios`
limits it. It adds an `e2e:*` script for each platform to `package.json`.

### Step 2: Wrap the root layout

Wrap the root layout in `<QuiescoRoot>` (`src/app/_layout.tsx` in the default template):

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

### Step 3: Give the home screen a test id

`<ThemedView style={styles.container} testID="home">` in `src/app/index.tsx`. The generated
`e2e/app.test.ts` checks that it is visible:

```ts
import { test } from '@quiesco/vitest';

test('the home screen is shown', async ({ app }) => {
  await app.expectVisible({ id: 'home' });
});
```

### Step 4: Let the home screen settle (optional)

You only need this step if the home screen has an animation that keeps running. Quiesco waits for the
screen to settle before it moves on, so an animation that runs for minutes makes it wait until
`SYNC_TIMEOUT`. If your home screen has none, skip this step.

The SDK 55 default template is one such case: it spins a decorative glow on the home screen for four
minutes. Later templates may not have it — check your own project. The fix is to give the element a
test id and have Quiesco ignore it when deciding whether the screen has settled.

In `src/components/animated-icon.web.tsx` (and `animated-icon.tsx` for iOS / Android):

```tsx
<Animated.View … style={styles.glow} testID="logo-glow">
```

Then uncomment this line in `quiesco.config.mts`:

```ts
sync: { ignoreElements: ['logo-glow'] },
```

### Step 5: Run it

Pick the platform. The test file is the same for all three.

**Web:**

```sh
npx playwright install chromium

# exports the web build with EXPO_PUBLIC_QUIESCO=1, then quiesco test --platform web
npm run e2e:web
```

The template renders on the server (`web.output: "server"`); Quiesco runs `npx expo serve` for that
export by itself. Static and single-page exports are served directly.

**iOS:**

Boot a simulator first (`open -a Simulator`, or `xcrun simctl boot "iPhone 17"`): Quiesco uses the
booted one.

```sh
# once: the dev client the e2e build is made of
npx expo install expo-dev-client

# quiesco build ios: prebuild with EXPO_PUBLIC_QUIESCO=1, then xcodebuild for the simulator
npm run e2e:build:ios

# quiesco test --platform ios
npm run e2e:ios
```

The first build takes a few minutes; later ones are skipped while the app config and the
dependencies stay the same. To have Quiesco boot a simulator itself, name it in `devices.ios` in
`quiesco.config.mts` (`{ device: 'iPhone 17' }`).

**Android:**

Start an emulator first (Android Studio's Device Manager, or `emulator -avd <name>`): Quiesco uses
the running one.

```sh
# once: the dev client the e2e build is made of
npx expo install expo-dev-client

# quiesco build android: prebuild with EXPO_PUBLIC_QUIESCO=1, then gradlew assembleDebug
npm run e2e:build:android

# quiesco test --platform android
npm run e2e:android
```

The first build takes a few minutes; later ones are skipped while the app config and the
dependencies stay the same. To have Quiesco boot an emulator itself, name the AVD in
`devices.android` in `quiesco.config.mts` (`emulator -list-avds` lists them).

`npx quiesco doctor` checks the setup and says how to fix what is missing.
`npx quiesco tree` prints the element tree of the running app to find test ids.

Next: write real tests in the [tutorial](../../writing-tests/references/tutorial.md), then see [test runners](../../quiesco-api/references/runners.md) and the
[API reference](../../quiesco-api/references/api.md).
