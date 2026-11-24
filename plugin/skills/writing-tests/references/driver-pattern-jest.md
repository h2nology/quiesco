<!-- Generated from docs/driver-pattern-jest.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Driver pattern with Jest

Give Jest tests a business driver, in plain JavaScript.
With Jest, the test files are plain JavaScript (`transform: {}`), so the
[driver](./driver-pattern.md#the-driver) is too. Each test makes one from the global `quiesco.app`.

## The driver in JavaScript {#driver}

```js
// e2e/todo-driver.js
/** Through the UI, with Quiesco. Only this class knows the test ids. */
class UiTodoDriver {
  /** @param {import('@quiesco/core').Driver} app */
  constructor(app) {
    this.app = app;
  }

  async seed(todos) {
    // setup without the UI
    await this.app.backdoor('seedTodos', todos);
  }

  async addTodo(title, notes) {
    await this.app.tap('add-todo');
    await this.app.type('title-input', title);
    if (notes !== undefined) await this.app.type('notes-input', notes);
    await this.app.tap('save-todo');
    await this.app.expectVisible('todo-list-screen');
  }

  async todoTitles() {
    return (await this.app.query('todo-title')).map((e) => e.text);
  }
}

module.exports = { UiTodoDriver };
```

The file does not end in `.test.js`, so Jest's `testMatch` does not run it as a test.

> **Warning:**
>
>   Up to Quiesco 0.13.4, `quiesco.app.backdoor()` under Jest rejects any object argument as "not JSON"
>   ([#115](https://github.com/h2nology/quiesco/issues/115)), so `seed()` fails until the fix is released.

## Tests {#tests}

```js
// e2e/todos.test.js
const { UiTodoDriver } = require('./todo-driver');

let todos;
beforeEach(() => {
  todos = new UiTodoDriver(quiesco.app);
});

test('a new todo appears at the top of the list', async () => {
  await todos.addTodo('Call the dentist');
  await todos.addTodo('Buy milk');

  expect(await todos.todoTitles()).toEqual(['Buy milk', 'Call the dentist']);
});
```

The test has no test ids and no taps. `quiesco.app` is still there for what the driver does not cover.

More on Jest in [Jest](../../quiesco-api/references/jest.md).
