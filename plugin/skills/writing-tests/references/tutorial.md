<!-- Generated from docs/tutorial.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Tutorial: test a todo app

Take a small todo app with three screens and write its end-to-end tests, step by step: test ids, flows across screens, backdoors, resets, and failures.
This tutorial starts from a working app and ends with eight tests that run unchanged on the web, iOS and
Android. Along the way you use everything a typical test needs: finding elements by test id, moving
between screens, filling in a form, setting up data through a backdoor, and reading a failure.

It takes about 30 minutes. You need Node.js 24+; for iOS and Android, the tools listed in the
[quick start](../../setup/references/quickstart.md).

## The app {#the-app}

[`examples/todo-tutorial`](https://github.com/h2nology/quiesco/tree/main/examples/todo-tutorial) is an
Expo Router app with three screens:

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

Copy the example out of the repository and install it:

```sh
npx degit h2nology/quiesco/examples/todo-tutorial quiesco-todo
cd quiesco-todo
npm install
```

Try the app with `npm run web` (or `npm start` for a dev client) if you like. The project is already set
up for Quiesco — it is what `npx quiesco init --runner vitest` plus the [quick start](../../setup/references/quickstart.md)
steps produce:

| File | What it does |
|---|---|
| `index.ts` | Imports `@quiesco/agent` before `expo-router/entry`, so the agent sees the app from the first render |
| `metro.config.js` | `withQuiesco()`: the real agent in e2e builds (`EXPO_PUBLIC_QUIESCO=1`), a no-op stub otherwise |
| `app.json` | Lists `@quiesco/expo-plugin`, and sets the bundle id / package that `quiesco.config.mts` names |
| `src/app/_layout.tsx` | Wraps the app in `<QuiescoRoot>`, and loads `src/e2e.ts` in e2e builds only |
| `quiesco.config.mts` | Where the app is on each platform: the web export, the simulator build, the APK |
| `vitest.config.mts` | Runs `e2e/**/*.test.ts` with Quiesco |
| `package.json` | The `e2e:*` scripts: `e2e:web`, `e2e:build:ios`, `e2e:ios`, `e2e:build:android`, `e2e:android` |

The tests are in `e2e/`. The steps below build them up one at a time; to follow along, empty both files
and add each test as you read it.

## Step 1: Give the elements test ids {#step-1-test-ids}

Tests find elements by their `testID`. A plain string in a test is a test id: `app.tap('add-todo')` taps
the element with `testID="add-todo"`. The app gives one to every element a test touches or checks:

| Screen | `testID` | Element |
|---|---|---|
| List | `todo-list-screen` | The screen itself |
| | `empty-state` | "Nothing to do", shown while the list is empty |
| | `todo-summary` | "1 of 2 done" |
| | `todo-row`, `todo-title`, `todo-checkbox` | Each row, its title, its checkbox |
| | `add-todo` | The New todo button |
| New todo | `new-todo-screen`, `title-input`, `notes-input`, `title-error`, `save-todo` | The screen, the fields, the error below the title, Save |
| Details | `todo-detail-screen`, `detail-title`, `detail-notes`, `todo-status` | The screen, the texts, the Open / Done badge |
| | `toggle-done`, `delete-todo` | The two buttons |

In the code a test id is one prop (`src/components/TodoRow.tsx`):

```tsx
<View testID="todo-row" style={[styles.row, { backgroundColor: c.surface }]}>
  <Checkbox testID="todo-checkbox" checked={todo.done} onToggle={onToggle} label={…} />
  …
</View>
```

Every row has the same ids; a test picks one row by position (`{ id: 'todo-title', index: 0 }` is the top
one) or by its text (`{ text: 'Buy milk' }`). With the app running, `npx quiesco tree` prints the element
tree with every id, to find the ones an app already has.

## Step 2: The first test {#step-2-first-test}

Start with what a fresh launch shows. In `e2e/list.test.ts`:

```ts
import { test } from '@quiesco/vitest';

test('a fresh start shows the empty list', async ({ app }) => {
  await app.expectVisible('empty-state');
  await app.expectCount('todo-row', 0);
});
```

`app` is the driver for the app under test. Run it on the web:

```sh
npx playwright install chromium

# exports the web build with EXPO_PUBLIC_QUIESCO=1, then quiesco test --platform web
npm run e2e:web
```

The first run starts Chromium and opens the app; the test passes in a few seconds. You will run the same
file on iOS and Android in [step 7](#step-7-ios-and-android).

## Step 3: A flow across screens {#step-3-flow-across-screens}

Now add a todo the way a user does: open the form, type, save, and check the list.

```ts
test('a new todo appears at the top of the list', async ({ app }) => {
  await app.tap('add-todo');
  await app.expectVisible('new-todo-screen');

  await app.type('title-input', 'Buy milk');
  await app.type('notes-input', 'Oat milk, 1 l');
  // Saving takes 600 ms, then the app goes back to the list. Quiesco waits for both: no sleep.
  await app.tap('save-todo');

  await app.expectVisible('todo-list-screen');
  await app.expectText({ id: 'todo-title', index: 0 }, 'Buy milk');
  await app.expectText('todo-summary', '0 of 1 done');
});
```

The test has no `sleep` and no `waitFor`, although every line depends on something that takes time: the
screen transition after `tap('add-todo')`, the 600 ms save timer, the way back to the list. Quiesco waits
for the app to be **idle** before and after every call — no pending timers, requests, renders or
animations ([synchronization](../../quiesco-api/references/sync.md)) — so each line starts where the previous one left the app.
Assertions also retry until they hold or time out.

`expectVisible('new-todo-screen')` is not needed for the test to pass, but it makes a failure clearer:
if the button stops opening the form, the test fails there and not at `type`.

## Step 4: What the user sees when something is wrong {#step-4-validation}

The form does not save a todo without a title. Check that the error shows and the form stays open, then go
back:

```ts
test('a todo needs a title', async ({ app }) => {
  await app.tap('add-todo');
  await app.tap('save-todo');

  await app.expectText('title-error', 'Enter a title');
  await app.expectVisible('new-todo-screen');

  // Back to the list as a user would: back button, browser back or swipe, depending on the platform.
  await app.goBack();
  await app.expectVisible('empty-state');
});
```

`goBack()` goes back the way the platform does it: the Android back button, the browser's back, the
navigation bar's back button on iOS. One line covers all three.

## Step 5: Start from data with a backdoor {#step-5-backdoor}

The details screen needs todos in the list. Typing them through the form in every test would work, but it
is slow, and a test about deleting a todo would fail whenever the form breaks. A **backdoor** is a
function the app registers for tests only; a test calls it to set up state directly.

Declare it once in a file that both the app and the tests compile (`src/backdoors.ts`):

```ts
export interface SeedTodo {
  title: string;
  notes?: string;
  done?: boolean;
}

declare module '@quiesco/agent' {
  interface Backdoors {
    /** Replaces the list with these todos (the first one at the top). */
    seedTodos: (todos: SeedTodo[]) => void;
  }
}
```

Register it in `src/e2e.ts`, the file `_layout.tsx` loads only in e2e builds, so none of it reaches
production:

```ts
import { quiesco } from '@quiesco/agent';

import type {} from './backdoors';
import { todoStore } from './store';

quiesco.backdoor('seedTodos', (todos) => {
  todoStore.replaceAll(todos);
});
```

```tsx
// src/app/_layout.tsx
if (process.env.EXPO_PUBLIC_QUIESCO === '1') {
  require('../e2e');
}
```

Now the tests for the details screen start with two todos (`e2e/detail.test.ts`):

```ts
import { test } from '@quiesco/vitest';

import type {} from '../src/backdoors';

const seed = [{ title: 'Buy milk', notes: 'Oat milk, 1 l' }, { title: 'Call the dentist' }];

test('a todo opens on its own screen', async ({ app }) => {
  await app.backdoor('seedTodos', seed);

  await app.tap({ text: 'Buy milk' });
  await app.expectVisible('todo-detail-screen');
  await app.expectText('detail-title', 'Buy milk');
  await app.expectText('detail-notes', 'Oat milk, 1 l');

  await app.goBack();
  await app.expectVisible('todo-list-screen');
});

test('marking a todo done shows in the list', async ({ app }) => {
  await app.backdoor('seedTodos', seed);

  await app.tap({ text: 'Call the dentist' });
  await app.tap('toggle-done');
  await app.expectText('todo-status', 'Done');

  await app.goBack();
  await app.expectChecked({ id: 'todo-checkbox', index: 1 });
  await app.expectNotChecked({ id: 'todo-checkbox', index: 0 });
  await app.expectText('todo-summary', '1 of 2 done');
});

test('the checkbox in the list toggles a todo', async ({ app }) => {
  await app.backdoor('seedTodos', seed);

  await app.tap({ id: 'todo-checkbox', index: 0 });
  await app.expectChecked({ id: 'todo-checkbox', index: 0 });
  await app.expectText('todo-summary', '1 of 2 done');
});

test('deleting a todo goes back to the list without it', async ({ app }) => {
  await app.backdoor('seedTodos', seed);

  await app.tap({ text: 'Buy milk' });
  await app.tap('delete-todo');

  await app.expectVisible('todo-list-screen');
  await app.expectCount('todo-row', 1);
  await app.expectNotExists({ text: 'Buy milk' });
});
```

Because of the declaration, `app.backdoor('seedTodos', …)` is type-checked: a misspelled name or a todo
without a title is a TypeScript error in the test. `{ text: 'Buy milk' }` finds the element by what the
user reads; `expectChecked` reads the checkbox's `accessibilityState`, the same state a screen reader
announces.

## Step 6: Every test starts clean {#step-6-reset}

Before every test Quiesco **soft-resets** the app: it clears storage (AsyncStorage on iOS / Android;
localStorage, sessionStorage and IndexedDB on the web), puts navigation back on the first screen and
remounts the app. It is much faster than restarting the app.

A remount does not clear JavaScript module state, and this app keeps its todos in a module variable. So
`src/e2e.ts` also tells Quiesco how to clear them:

```ts
// Quiesco soft-resets the app before every test: storage is cleared and the app is remounted. The todos
// live in a module variable, which a remount keeps, so clear them here.
quiesco.onReset(() => {
  todoStore.replaceAll([]);
});
```

The last test in `e2e/detail.test.ts` checks it:

```ts
test('every test starts with an empty list', async ({ app }) => {
  // The tests above left todos behind; the soft reset and the onReset hook in src/e2e.ts cleared them.
  await app.expectVisible('empty-state');
});
```

Remove the `onReset` hook and this test fails with the todos of the test before it still on screen. Any
state that lives outside React and storage — module variables, caches such as a React Query client, an
in-memory database — needs an `onReset` hook.

## Step 7: Run on iOS and Android {#step-7-ios-and-android}

The tests do not change. Build the e2e app once per platform, then run the same files:

**iOS:**

```sh
# boot a simulator first: open -a Simulator

# prebuild with EXPO_PUBLIC_QUIESCO=1 and xcodebuild: a few minutes the first time
npm run e2e:build:ios

npm run e2e:ios
```

**Android:**

```sh
# start an emulator first: Android Studio's Device Manager, or emulator -avd <name>

# prebuild with EXPO_PUBLIC_QUIESCO=1 and gradlew assembleDebug: a few minutes the first time
npm run e2e:build:android

npm run e2e:android
```

`quiesco test` installs the build, starts Metro for the dev client, runs the tests and stops Metro. On iOS
and Android `tap` and `type` are real touches and keyboard input, not calls into the components: a button
covered by the keyboard or another view fails the test (`ELEMENT_OBSCURED`), as it would stop a user.

## When a test fails {#when-a-test-fails}

Change the expected title in step 3 to `'Buy bread'` and run the tests again. The test fails after the
assertion's timeout with what it expected, what it found and where the app was:

```text
QuiescoError: expect text failed after 10000ms for { id: "todo-title", index: 0 }: expected "Buy bread", actual "Buy milk" (current route: /)

Quiesco evidence:
  artifacts/20261123-212209-web/001-a-new-todo-appears-at-the-top-of-the-list/failure.png
  artifacts/20261123-212209-web/001-a-new-todo-appears-at-the-top-of-the-list/elements.json
  …
```

The `artifacts/` folder has, per failed test:

| File | What it shows |
|---|---|
| `failure.png` | The screen at the failure, with the elements of the failed call framed in red |
| `elements.json` | The current route and every element with a test id, label or text, visible or not and why |
| `element-tree.json` | The whole element tree |
| `idle-state.json` | What was busy, when a wait for idle timed out |
| `timeline.html` | Every call of the test with its duration and how long it waited for the app |

To run tests from a page in the browser instead — one test at a time, with the run's progress and a
failure's evidence on the page — install `@quiesco/ui` and start `npx quiesco ui --platform web`
([test UI](https://shift-14cc7601.mintlify.site/ui)).

## Next steps {#next-steps}

- [Synchronization](../../quiesco-api/references/sync.md): what idle means, and what to do with an animation that never stops.
- [API reference](../../quiesco-api/references/api.md): every action and assertion, and the matchers (`within`, `has`, regular
  expressions).
- [Driver pattern](./driver-pattern.md): keep test ids out of the tests once a suite grows.
- [Example app](https://shift-14cc7601.mintlify.site/example-app): a larger app with a backend, parallel runs and EAS builds for CI.
