# Driver pattern

Feature files should state what the user wants, not which buttons they press. Steps in business language
call a **driver** of your own, and only the driver knows about test ids and taps. When the UI changes,
the driver changes; the features and steps do not.

```gherkin
Scenario: A new todo appears at the top of the list
  Given the user "a@example.com" is logged in
  When they add a todo "Buy milk"
  Then the first todo is "Buy milk"
```

## A business driver on top of `this.app`

```ts
// features/support/todo-driver.ts
import type { Driver } from '@quiesco/core';

/** What the todo features need, in the language of the business. */
export interface TodoDriver {
  loginAs(email: string): Promise<void>;
  addTodo(title: string): Promise<void>;
  todoTitles(): Promise<string[]>;
}

/** Through the UI, with Quiesco. */
export class UiTodoDriver implements TodoDriver {
  constructor(private readonly app: Driver) {}

  async loginAs(email: string) {
    await this.app.backdoor('loginAs', email);       // setup without the UI
  }

  async addTodo(title: string) {
    await this.app.tap('add-todo');
    await this.app.type('todo-title', title);
    await this.app.tap({ role: 'button', text: 'Save' });
  }

  async todoTitles() {
    return (await this.app.query('todo-item')).map((e) => e.text);
  }
}
```

Give the World a driver and register it instead of the default World:

```ts
// features/support/world.ts
import { QuiescoWorld, registerQuiesco } from '@quiesco/cucumber';

import { UiTodoDriver } from './todo-driver';

export class TodoWorld extends QuiescoWorld {
  get todos() {
    return new UiTodoDriver(this.app);
  }
}

registerQuiesco({ world: TodoWorld });   // instead of import '@quiesco/cucumber/register'
```

Steps then read like the feature:

```ts
// features/step_definitions/todos.steps.ts
import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';

import type { TodoWorld } from '../support/world';

Given('the user {string} is logged in', async function (this: TodoWorld, email: string) {
  await this.todos.loginAs(email);
});

When('they add a todo {string}', async function (this: TodoWorld, title: string) {
  await this.todos.addTodo(title);
});

Then('the first todo is {string}', async function (this: TodoWorld, title: string) {
  assert.equal((await this.todos.todoTitles())[0], title);
});
```

Prefer Quiesco's assertions where they fit (`this.app.expectText('todo-item', …)`): they retry until the
app shows the expected state. A plain `assert` on a query result checks once — fine after an action,
because the action already waited for the app to be idle.

## Ports & adapters: the same features against the API

Because the steps only see `TodoDriver`, a second implementation can run the same features without any
UI — against the backend API, in seconds, for example on every commit:

```ts
export class ApiTodoDriver implements TodoDriver {
  private token = '';
  constructor(private readonly baseUrl: string) {}

  async loginAs(email: string) {
    const res = await fetch(`${this.baseUrl}/login`, { method: 'POST', body: JSON.stringify({ email }) });
    this.token = ((await res.json()) as { token: string }).token;
  }

  async addTodo(title: string) {
    await fetch(`${this.baseUrl}/todos`, { method: 'POST', headers: { authorization: this.token }, body: JSON.stringify({ title }) });
  }

  async todoTitles() {
    const res = await fetch(`${this.baseUrl}/todos`, { headers: { authorization: this.token } });
    return ((await res.json()) as { title: string }[]).map((t) => t.title);
  }
}
```

Select the driver with an environment variable or a cucumber profile. The API run does not need
Quiesco at all: give it its own World (a plain cucumber `World` with an `ApiTodoDriver`) and leave out
the Quiesco registration in that profile.

## Generic steps

`@quiesco/steps` offers ready-made steps such as `点击 "add-todo"` / `"add-todo" をタップする` /
`I tap "add-todo"`. They are operation scripts — useful to explore an app or sketch a prototype, but they
tie features to the UI. Move to business-language steps as soon as the features describe real
requirements. See [packages/steps](../packages/steps/README.md).
