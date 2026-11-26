# Quiesco todo tutorial (Vitest)

A small Expo Router app — a todo list, a new-todo form and a details screen — with the end-to-end tests
that the [Quiesco tutorial](https://docs.quiesco.dev/tutorial/vitest) builds step by step, written with Vitest.
The same app with the other runners: [Jest](../todo-tutorial-jest), [Cucumber](../todo-tutorial-cucumber).

It is a standalone npm project that uses the published Quiesco packages (it is not part of the
repository's pnpm workspace). Copy it out and install it:

```sh
npx degit h2nology/quiesco/examples/todo-tutorial-vitest quiesco-todo
cd quiesco-todo
npm install
```

Run the tests:

```sh
# web
npx playwright install chromium
npm run e2e:web

# iOS (boot a simulator first)
npm run e2e:build:ios
npm run e2e:ios

# Android (start an emulator first)
npm run e2e:build:android
npm run e2e:android
```

| Path | What it is |
|---|---|
| `src/app/` | The screens: `index.tsx` (list), `new.tsx` (form), `todo/[id].tsx` (details) |
| `src/store.ts` | The todos, in memory |
| `src/backdoors.ts`, `src/e2e.ts` | The `seedTodos` backdoor and the reset hook (e2e builds only) |
| `src/theme.ts` | Design tokens from the Quiesco design system ([DESIGN.md](https://github.com/h2nology/quiesco/blob/main/DESIGN.md)): colors for light and dark mode, Geist type, spacing, radii |
| `e2e/` | The tests (`*.test.ts`) |
| `quiesco.config.mts`, `vitest.config.mts` | Quiesco and Vitest configuration |
