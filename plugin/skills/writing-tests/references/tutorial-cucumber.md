<!-- Generated from docs/tutorial-cucumber.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Tutorial: test a todo app with Cucumber

Take a small todo app with three screens and write its end-to-end tests, step by step: test ids, flows across screens, backdoors, resets, and failures.
This page writes the eight tests of the [todo-app tutorial](./tutorial.md) with **Cucumber**. Read about
[the app](./tutorial.md#the-app) and [get the project](./tutorial.md#get-the-project) there first. The same tests are
also written for [Vitest](./tutorial-vitest.md) and [Jest](./tutorial-jest.md).

## The test files {#test-files}

In [`todo-tutorial-cucumber`](https://github.com/h2nology/quiesco/tree/main/examples/todo-tutorial-cucumber), `cucumber.mjs` loads `features/support/quiesco.ts`, which registers Quiesco, and
the step definitions ([Cucumber](../../quiesco-api/references/cucumber.md)). The scenarios are in `features/list.feature` and
`features/detail.feature`, their steps in `features/step_definitions/todo.steps.ts`; a step reaches the
app through `this.app`. To follow along, empty the three files and add each scenario and its steps as you
read them.

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
<View testID="todo-row" style={styles.row}>
  <Checkbox testID="todo-checkbox" checked={todo.done} onToggle={onToggle} label={…} />
  …
</View>
```

Every row has the same ids; a test picks one row by position (`{ id: 'todo-title', index: 0 }` is the top
one) or by its text (`{ text: 'Buy milk' }`). With the app running, `npx quiesco tree` prints the element
tree with every id, to find the ones an app already has.

## Step 2: The first test {#step-2-first-test}

Start with what a fresh launch shows:

```gherkin features/list.feature
Feature: The todo list

  Scenario: A fresh start shows the empty list
    Then the list is empty
```

```ts features/step_definitions/todo.steps.ts
import { type DataTable, Given, Then, When } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';

import type { SeedTodo } from '../../src/backdoors.ts';

Then('the list is empty', async function (this: QuiescoWorld) {
  await this.app.expectVisible('empty-state');
  await this.app.expectCount('todo-row', 0);
});
```

`this.app` is the driver for the app under test. The steps read like the user's actions and checks;
the test ids stay in the step definitions. (`Given`, `When`, `DataTable` and `SeedTodo` are for the
steps further down.)

Run it on the web:

```sh
npx playwright install chromium

# exports the web build with EXPO_PUBLIC_QUIESCO=1, then quiesco test --platform web
npm run e2e:web
```

The first run starts Chromium and opens the app; the test passes in a few seconds. You will run the same
file on iOS and Android in [step 7](#step-7-ios-and-android).

## Step 3: A flow across screens {#step-3-flow-across-screens}

Now add a todo the way a user does: open the form, type, save, and check the list.

```gherkin features/list.feature
  Scenario: A new todo appears at the top of the list
    When I add a todo "Buy milk" with the notes "Oat milk, 1 l"
    Then the first todo is "Buy milk"
    And the summary reads "0 of 1 done"
```

```ts features/step_definitions/todo.steps.ts
When('I add a todo {string} with the notes {string}', async function (this: QuiescoWorld, title: string, notes: string) {
  await this.app.tap('add-todo');
  await this.app.expectVisible('new-todo-screen');

  await this.app.type('title-input', title);
  await this.app.type('notes-input', notes);
  // Saving takes 600 ms, then the app goes back to the list. Quiesco waits for both: no sleep.
  await this.app.tap('save-todo');

  await this.app.expectVisible('todo-list-screen');
});

Then('the first todo is {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.expectText({ id: 'todo-title', index: 0 }, title);
});

Then('the summary reads {string}', async function (this: QuiescoWorld, summary: string) {
  await this.app.expectText('todo-summary', summary);
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

```gherkin features/list.feature
  Scenario: A todo needs a title
    When I save a new todo without a title
    Then the form says "Enter a title"
    When I go back
    Then the list is empty
```

```ts features/step_definitions/todo.steps.ts
When('I save a new todo without a title', async function (this: QuiescoWorld) {
  await this.app.tap('add-todo');
  await this.app.tap('save-todo');
});

Then('the form says {string}', async function (this: QuiescoWorld, error: string) {
  await this.app.expectText('title-error', error);
  await this.app.expectVisible('new-todo-screen');
});

When('I go back', async function (this: QuiescoWorld) {
  // Back as a user would: back button, browser back or swipe, depending on the platform.
  await this.app.goBack();
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

Now the tests for the details screen start with two todos:

The `Background` runs before every scenario of the feature:

```gherkin features/detail.feature
Feature: Todo details

  Background:
    Given these todos:
      | title            | notes         |
      | Buy milk         | Oat milk, 1 l |
      | Call the dentist |               |

  Scenario: A todo opens on its own screen
    When I open the todo "Buy milk"
    Then I see the details of "Buy milk" with the notes "Oat milk, 1 l"
    When I go back
    Then I see the list

  Scenario: Marking a todo done shows in the list
    When I open the todo "Call the dentist"
    And I mark it as done
    Then its status is "Done"
    When I go back
    Then todo 2 is checked
    And todo 1 is not checked
    And the summary reads "1 of 2 done"

  Scenario: The checkbox in the list toggles a todo
    When I check todo 1
    Then todo 1 is checked
    And the summary reads "1 of 2 done"

  Scenario: Deleting a todo goes back to the list without it
    When I open the todo "Buy milk"
    And I delete it
    Then I see the list
    And the list has 1 todo
    And there is no todo "Buy milk"
```

```ts features/step_definitions/todo.steps.ts
Given('these todos:', async function (this: QuiescoWorld, table: DataTable) {
  // An empty cell is an empty string: leave the notes out instead.
  const todos: SeedTodo[] = table.hashes().map(({ title, notes }) => (notes ? { title, notes } : { title }));
  await this.app.backdoor('seedTodos', todos);
});

When('I open the todo {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.tap({ text: title });
  await this.app.expectVisible('todo-detail-screen');
});

Then('I see the details of {string} with the notes {string}', async function (this: QuiescoWorld, title: string, notes: string) {
  await this.app.expectText('detail-title', title);
  await this.app.expectText('detail-notes', notes);
});

Then('I see the list', async function (this: QuiescoWorld) {
  await this.app.expectVisible('todo-list-screen');
});

When('I mark it as done', async function (this: QuiescoWorld) {
  await this.app.tap('toggle-done');
});

Then('its status is {string}', async function (this: QuiescoWorld, status: string) {
  await this.app.expectText('todo-status', status);
});

When('I check todo {int}', async function (this: QuiescoWorld, n: number) {
  await this.app.tap({ id: 'todo-checkbox', index: n - 1 });
});

Then('todo {int} is checked', async function (this: QuiescoWorld, n: number) {
  await this.app.expectChecked({ id: 'todo-checkbox', index: n - 1 });
});

Then('todo {int} is not checked', async function (this: QuiescoWorld, n: number) {
  await this.app.expectNotChecked({ id: 'todo-checkbox', index: n - 1 });
});

When('I delete it', async function (this: QuiescoWorld) {
  await this.app.tap('delete-todo');
});

Then('the list has {int} todo(s)', async function (this: QuiescoWorld, count: number) {
  await this.app.expectCount('todo-row', count);
});

Then('there is no todo {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.expectNotExists({ text: title });
});
```

Because of the declaration (the step file imports `src/backdoors.ts`), `this.app.backdoor('seedTodos', …)`
is type-checked: a misspelled name or a todo without a title is a TypeScript error in the step.

`{ text: 'Buy milk' }` finds the element by what the user reads; `expectChecked` reads the checkbox's
`accessibilityState`, the same state a screen reader announces.

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

One more test checks it:

The `Background` of `features/detail.feature` seeds every scenario there, so this one goes at the end of
`features/list.feature`, after the scenario that added a todo:

```gherkin features/list.feature
  Scenario: Every scenario starts with an empty list
    # The scenarios above left a todo behind; the soft reset and the onReset hook in src/e2e.ts cleared it.
    Then the list is empty
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

Change `Then the first todo is "Buy milk"` in step 3 to `Then the first todo is "Buy bread"`
and run the tests again. The test fails after the
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
