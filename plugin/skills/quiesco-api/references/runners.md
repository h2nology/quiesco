<!-- Generated from docs/runners.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Test runners

Vitest (recommended), Jest or Cucumber: one session for the run, a reset before every test, evidence on failure.
Quiesco drives the app from your test runner. Three have ready-made integrations, and they all work the
same way: one session (device and app) for the whole run, a reset before every test, tests tagged for
another platform or browser skipped (`@ios`, `@android`, `@web`, `@native`, `@chromium`, `@firefox`, `@webkit`; the innermost level wins), and a
failure's message lists the evidence files (screenshot, element tree, idle state, logs).

| Runner | Package | Tests | The app |
|---|---|---|---|
| **Vitest** (recommended) | `@quiesco/vitest` | TypeScript, `test(…)` | the `app` fixture |
| Jest | `@quiesco/jest` | JavaScript, `test(…)` | the global `quiesco.app` |
| Cucumber | `@quiesco/cucumber` | Gherkin features and step definitions | `this.app` in steps |

## Choosing one {#choosing}

`quiesco init` asks which runner to use (Vitest is preselected; in CI it takes Vitest without asking) and
installs only that runner's packages, its config and a first test. To choose without the question:

```sh
npx quiesco init --runner vitest     # or jest, cucumber
```

`quiesco test`, `quiesco ui` and `quiesco list` then use the runner whose Quiesco package is installed, so
`--runner` is not needed. When several are installed (or none), they use Cucumber, as Quiesco 0.6 and
earlier did; `--runner` picks another.

## Vitest {#vitest}

`app` is a test fixture. `quiesco init --runner vitest` writes the config (`vitest.config.mts`) and a first
test (`e2e/app.test.ts`):

```ts
// vitest.config.mts
import { quiesco, quiescoPlugin } from '@quiesco/vitest/config';
import { defineConfig } from 'vitest/config';
export default defineConfig({ plugins: [quiescoPlugin()], test: { ...quiesco(), include: ['e2e/**/*.test.ts'] } });

// e2e/todo.test.ts
import { test } from '@quiesco/vitest';

test('a new todo appears at the top', async ({ app }) => {
  await app.tap('add-todo');                      // waits until the app is idle, then taps
  await app.type('todo-title', 'Buy milk');
  await app.tap({ role: 'button', text: 'Save' });
  await app.expectText({ id: 'todo-item', index: 0 }, 'Buy milk');
});
test('Android only', { tags: ['@android'] }, async ({ app }) => { /* … */ });
```

`quiesco()` keeps the app across files (`isolate: false`), runs them one at a time (or on N devices with
`quiesco({ workers: N })`) and declares the platform tags. `quiescoPlugin()` sends the run's progress to the
progress bar of `quiesco test` and to `quiesco ui`; it adds its reporter only when they run Vitest, next to
your own reporters.

**Hooks shared by every file go in `setupFiles`.** Since the files share their modules (`isolate: false`), a
support module imported by every test file runs once per worker: a `test.beforeEach(…)` at its top level is
registered for the first file that imports it only, and the later files run without it, silently. Register
such hooks in each test file, or in a setup file, which runs before every file:

```ts
// vitest.config.mts
test: { ...quiesco(), include: ['e2e/**/*.test.ts'], setupFiles: ['e2e/setup.ts'] },

// e2e/setup.ts
import { test } from '@quiesco/vitest';
test.beforeEach(async ({ app }) => { await app.openUrl('myapp://home'); });
```

## Jest {#jest}

A preset; tests reach the app through the global `quiesco`. `quiesco init --runner jest` writes the config
(`jest.config.cjs`) and a first test (`e2e/app.test.js`):

```js
// jest.config.cjs
module.exports = { preset: '@quiesco/jest', maxWorkers: 1, testTimeout: 120_000 }; // maxWorkers: N = N devices

// e2e/todo.test.js
test('a new todo appears at the top @ios', async () => {
  await quiesco.app.tap('add-todo');
});
```

Platform tags go in test or `describe` titles (Jest has no test options). The preset also adds the reporter
that sends the run's progress to `quiesco test` and `quiesco ui`. A config with its own `reporters` replaces
the preset's: add `'@quiesco/jest/reporter'` there (next to `'default'`).

## Cucumber {#cucumber}

Features in Gherkin, steps that reach the app through `this.app`:

```gherkin
Scenario: A new todo appears at the top of the list
  When they add a todo "Buy milk"
  Then the first todo is "Buy milk"
```

```ts
When('they add a todo {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.tap('add-todo');                 // waits until the app is idle, then taps
  await this.app.type('todo-title', title);
  await this.app.tap({ role: 'button', text: 'Save' });
});
```

`quiesco init --runner cucumber` writes `cucumber.mjs`, `features/support/quiesco.ts` (the World and the
lifecycle hooks) and a first feature with its step. Business-language steps on top of `this.app` are in
[the driver pattern](../../writing-tests/references/driver-pattern.md); generic steps for prototyping in [generic steps](../../writing-tests/references/steps.md).

## Running {#running}

Run the tests with `npx quiesco test --platform ios` (`--runner vitest|jest|cucumber` to choose another than
the installed one), or from the browser with [`quiesco ui`](https://shift-14cc7601.mintlify.site/ui). All three are in
[examples/todo-app](https://github.com/h2nology/quiesco/tree/main/examples/todo-app); details in
[Vitest, Jest and other runners](./api.md#using-quiesco-without-cucumber), several devices at once in
[parallel runs](./parallel.md).
