<!-- Generated from docs/quickstart.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Quick start (web)

From a new Expo app to a passing test in Chromium, in about 10 minutes.
Requirements: Node.js 24+, an Expo app on SDK 55 or later (`npx create-expo-app@latest`).

### Step 1: Set up the project

```sh
cd my-app
npx quiesco init          # dependencies, config plugin, Metro, entry file, quiesco.config.mts, a first test
```

`init` asks which test runner to use: press Enter for Vitest (recommended), or choose Jest or Cucumber
([test runners](../../quiesco-api/references/runners.md)). `--runner vitest|jest|cucumber` chooses without the question. The steps
below use Vitest; with the others only the file names differ.

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

### Step 4 (optional): Let the home screen settle

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

```sh
npx playwright install chromium
npm run e2e:web           # exports the web build with EXPO_PUBLIC_QUIESCO=1, then quiesco test --platform web
```

The template renders on the server (`web.output: "server"`); Quiesco runs `npx expo serve` for that
export by itself. Static exports are served directly.

`npx quiesco doctor` checks the setup and says how to fix what is missing.
`npx quiesco tree` prints the element tree of the running app to find test ids.

Next: [iOS and Android](./native.md), [test runners](../../quiesco-api/references/runners.md), and the [API reference](../../quiesco-api/references/api.md).
