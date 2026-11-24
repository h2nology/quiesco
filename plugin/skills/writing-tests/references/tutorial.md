<!-- Generated from docs/tutorial.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Tutorial: test a todo app

Take a small todo app with three screens and write its end-to-end tests, step by step: test ids, flows across screens, backdoors, resets, and failures.
This tutorial starts from a working app and ends with eight tests that run unchanged on the web, iOS and
Android. Along the way you use everything a typical test needs: finding elements by test id, moving
between screens, filling in a form, setting up data through a backdoor, and reading a failure.

The tests are written three times, once for each [test runner](../../quiesco-api/references/runners.md). Set up the project on this page,
then pick one: the steps are the same, only the test code differs.

It takes about 30 minutes. You need Node.js 24+; for iOS and Android, the tools listed in the
[quick start](../../setup/references/quickstart.md).

## The app {#the-app}

The app is an Expo Router app with three screens. The repository has it three times, once per test runner:
[`todo-tutorial-vitest`](https://github.com/h2nology/quiesco/tree/main/examples/todo-tutorial-vitest), [`todo-tutorial-jest`](https://github.com/h2nology/quiesco/tree/main/examples/todo-tutorial-jest) and [`todo-tutorial-cucumber`](https://github.com/h2nology/quiesco/tree/main/examples/todo-tutorial-cucumber); only the tests differ.

- The list (/): The todo list with two todos, one checked off, and a New todo button
- New todo (/new): The new-todo form with a title and a notes field and a Save button
- Details (/todo/[id]): The details of a todo with Mark as done and Delete todo buttons

- **The list** shows every todo with a checkbox, and how many are done. **New todo** opens the form;
  tapping a todo opens its details.
- **New todo** asks for a title and optional notes. Saving takes a moment (it stands in for a request to a
  backend), then the app goes back to the list.
- **Details** shows one todo and has two buttons: mark it done (or open again) and delete it.

The todos live in memory (`src/store.ts`): every launch starts with an empty list.

## Get the project {#get-the-project}

Copy the example for your runner out of the repository and install it:

**Vitest:**

```sh
npx degit h2nology/quiesco/examples/todo-tutorial-vitest quiesco-todo
cd quiesco-todo
npm install
```

**Jest:**

```sh
npx degit h2nology/quiesco/examples/todo-tutorial-jest quiesco-todo
cd quiesco-todo
npm install
```

**Cucumber:**

```sh
npx degit h2nology/quiesco/examples/todo-tutorial-cucumber quiesco-todo
cd quiesco-todo
npm install
```

Try the app with `npm run web` (or `npm start` for a dev client) if you like. The project is already set
up for Quiesco — it is what `npx quiesco init --runner <runner>` plus the [quick start](../../setup/references/quickstart.md)
steps produce:

| File | What it does |
|---|---|
| `index.ts` | Imports `@quiesco/agent` before `expo-router/entry`, so the agent sees the app from the first render |
| `metro.config.js` | `withQuiesco()`: the real agent in e2e builds (`EXPO_PUBLIC_QUIESCO=1`), a no-op stub otherwise |
| `app.json` | Lists `@quiesco/expo-plugin`, and sets the bundle id / package that `quiesco.config.mts` names |
| `src/app/_layout.tsx` | Wraps the app in `<QuiescoRoot>`, and loads `src/e2e.ts` in e2e builds only |
| `quiesco.config.mts` | Where the app is on each platform: the web export, the simulator build, the APK |
| `vitest.config.mts`, `jest.config.cjs` or `cucumber.mjs` | The runner's configuration: which test files it runs with Quiesco |
| `package.json` | The `e2e:*` scripts: `e2e:web`, `e2e:build:ios`, `e2e:ios`, `e2e:build:android`, `e2e:android` |

## Pick a runner {#pick-a-runner}

- [Vitest (recommended)](./tutorial-vitest.md): Tests in TypeScript, with the app as the `app` fixture.
- [Jest](./tutorial-jest.md): Tests in JavaScript, with the app in the global `quiesco.app`.
- [Cucumber](./tutorial-cucumber.md): Scenarios in Gherkin, step definitions in TypeScript.
