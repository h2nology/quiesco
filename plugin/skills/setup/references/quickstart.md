<!-- Generated from docs/quickstart.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Quick start (web)

From a new Expo app to a passing feature in Chromium, in about 10 minutes.
Requirements: Node.js 24+, an Expo app on SDK 55 or later (`npx create-expo-app@latest`).

### Step 1: Set up the project

```sh
cd my-app
npx quiesco init          # dependencies, config plugin, Metro, entry file, quiesco.config.mts, a first feature
```

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
`features/app.feature` checks that it is visible.

### Step 4: Let the home screen settle

The default template spins a decorative glow on the home screen for four minutes, so the screen never
settles. Give it a test id — `<Animated.View … style={styles.glow} testID="logo-glow">` in
`src/components/animated-icon.web.tsx` (and `animated-icon.tsx` for iOS / Android) — and uncomment
`sync: { ignoreElements: ['logo-glow'] }` in `quiesco.config.mts`.

### Step 5: Run it

```sh
npx playwright install chromium
npm run e2e:web           # exports the web build with EXPO_PUBLIC_QUIESCO=1, then quiesco test --platform web
```

The template renders on the server (`web.output: "server"`); Quiesco runs `npx expo serve` for that
export by itself. Static exports are served directly.

`npx quiesco doctor` checks the setup and says how to fix what is missing.
`npx quiesco tree` prints the element tree of the running app to find test ids.

Next: [iOS and Android](./native.md), [the driver pattern](../../writing-tests/references/driver-pattern.md) for steps in business language,
and the [API reference](../../quiesco-api/references/api.md).
