<!-- Generated from docs/driver-pattern-cucumber.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Driver pattern with Cucumber

Business-language steps on a driver in the World, so features survive UI changes.
With Cucumber, the [driver](./driver-pattern.md#the-driver) lives on the World, and the steps call it.
Features then state what the user wants, not which buttons they press:

```gherkin
Feature: Todos

  Scenario: A new todo appears at the top of the list
    Given the todo "Call the dentist"
    When I add a todo "Buy milk"
    Then the todos are "Buy milk", "Call the dentist"
```

## The driver on the World {#world}

Put the driver in `features/support/todo-driver.ts`, the code from the [overview](./driver-pattern.md#the-driver)
with one change: the import names the `.ts` file (`'../../src/backdoors.ts'`; see
[below](#type-stripping)).

Give the World a getter for it, and register that World instead of the default one:

```ts
// features/support/world.ts
import { QuiescoWorld, registerQuiesco } from '@quiesco/cucumber';

import { type TodoDriver, UiTodoDriver } from './todo-driver.ts';

export class TodoWorld extends QuiescoWorld {
  get todos(): TodoDriver {
    return new UiTodoDriver(this.app);
  }
}

// instead of import '@quiesco/cucumber/register'
registerQuiesco({ world: TodoWorld });
```

`registerQuiesco()` replaces `import '@quiesco/cucumber/register'` in `features/support/quiesco.ts`; do
not keep both ([`registerQuiesco()`](../../quiesco-api/references/cucumber.md#register-quiesco)).

## Steps {#steps}

Steps then read like the feature:

```ts
// features/step_definitions/todos.steps.ts
import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';

import type { TodoWorld } from '../support/world.ts';

Given('the todo {string}', async function (this: TodoWorld, title: string) {
  await this.todos.seed([{ title }]);
});

When('I add a todo {string}', async function (this: TodoWorld, title: string) {
  await this.todos.addTodo(title);
});

Then('the todos are {string}, {string}', async function (this: TodoWorld, first: string, second: string) {
  assert.deepEqual(await this.todos.todoTitles(), [first, second]);
});
```

In a step, `this.platform` is the same as `this.app.platform` ([per-platform steps](./driver-pattern.md#per-platform-steps)).

## Step files are not compiled {#type-stripping}

cucumber-js loads step and support files with Node's type stripping: Node removes the types and runs the
rest as JavaScript, without `tsc`. Two rules follow:

- **Relative imports name the `.ts` file:** `import { UiTodoDriver } from './todo-driver.ts'`.
  `npx quiesco init` adds `"allowImportingTsExtensions": true` to `tsconfig.json`, so `tsc` accepts
  them.
- **No TypeScript syntax that generates code:** parameter properties
  (`constructor(private app: Driver)`), `enum` and `namespace` fail with
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Declare the field and assign it in the constructor; use a union
  of string literals or an object `as const` instead of an `enum`.

`npx cucumber-js --dry-run` loads every step file without starting the app, so it finds both kinds of
mistakes in seconds.

## The same features against the API {#api-run}

With an [`ApiTodoDriver`](./driver-pattern.md#ports-adapters-the-same-features-against-the-api), the same
features run without the app. Select the driver with an environment variable or a cucumber profile. The
API run does not need Quiesco at all: give it its own World (a plain cucumber `World` with an
`ApiTodoDriver`) and leave out the Quiesco registration in that profile.

## Generic steps {#generic-steps}

`@quiesco/steps` offers ready-made steps such as `点击 "add-todo"` / `"add-todo" をタップする` /
`I tap "add-todo"`. They are operation scripts — useful to explore an app or sketch a prototype, but they
tie features to the UI. Move to business-language steps as soon as the features describe real
requirements. See [generic steps](./steps.md).

More on Cucumber in [Cucumber](../../quiesco-api/references/cucumber.md).
