---
name: writing-tests
description: This skill should be used in projects that use Quiesco (a `quiesco.config.*` file or `@quiesco/*` dependencies) when the user asks to "write an e2e test", "add a scenario", "cover this bug with an e2e test", "add a test for this screen", "write a feature file", "add step definitions", "turn this requirement into a Gherkin scenario", "add a Vitest / Jest e2e test", "find the testID for …", or when Claude edits `features/`, `e2e/`, `*.feature` or `*.steps.ts` files there. Covers business-language Gherkin, step definitions on the Quiesco Driver, the driver pattern, testIDs, platform tags, and verifying the new test runs.
---

# Writing Quiesco tests

Write tests that describe what the user wants in business language, implemented on top of the Quiesco
Driver. For exact API signatures, consult the `quiesco-api` skill and its references.

## Before writing

1. **Detect the runner.** `@quiesco/vitest` → Vitest (what `quiesco init` recommends); `@quiesco/jest` →
   Jest; `@quiesco/cucumber` / `cucumber.mjs` → Cucumber. Follow the existing layout
   (`features/step_definitions/`, `features/support/`, or `e2e/*.test.ts`).
2. **Read the existing steps and drivers** before adding new ones. Reuse a step whose wording already
   fits; a near-duplicate step with different wording splits the vocabulary. Grep step patterns:
   `grep -rn "Given(\|When(\|Then(" features/`.
3. **Find the elements.** Read the screen's component source for `testID`s. When the app is running (or
   can be launched), `npx quiesco tree` prints the live element tree (`#testID`, text, `[role]`);
   `npx quiesco tree --launch --platform web` boots it first. `--json` gives the full tree.
4. **Missing testIDs are app changes.** Propose the `testID` additions (files and elements) and wait
   for the user's approval before editing app code, unless the user already asked for app changes; prefer a testID over matching on display text that will be translated or
   reworded.

## Feature files

- One feature per capability; scenarios state behaviour, not clicks:
  `When they add a todo "Buy milk"` — not `When I tap "add-todo" and type "Buy milk" into "todo-title"`.
- `Given` sets up state (prefer backdoors over UI), `When` is the one action under test, `Then` checks
  an observable outcome.
- Keep each scenario independent: it starts from a soft reset and may run on any worker, in any order.
- Platform-specific scenarios get `@ios`, `@android`, `@web` or `@native` (the innermost level wins);
  untagged scenarios run everywhere. `@hard-reset` only when the soft reset cannot clear the state.
- Match the language of existing features (`# language: zh-CN` / `ja` are common); keep step wording
  consistent with what is already there.
- `@quiesco/steps` (generic `I tap "x"` steps) is for prototyping only; do not use it for requirement
  features. See `references/steps.md` when the project already uses it.

## Step definitions and drivers

Use the driver pattern once a feature has more than a couple of steps, or when one exists already:
steps call a driver in business terms; only the driver knows testIDs and taps. Full example with
`TodoDriver`, `UiTodoDriver`, a custom World and `registerQuiesco({ world })`:
`references/driver-pattern.md`.

```ts
When('they add a todo {string}', async function (this: TodoWorld, title: string) {
  await this.todos.addTodo(title);
});
```

Rules for step and support files (cucumber-js loads them with Node's type stripping, no `tsc`):

- Relative imports name the `.ts` file: `import { UiTodoDriver } from './todo-driver.ts'`.
- No TypeScript that generates code: no parameter properties (`constructor(private app: Driver)`), no
  `enum`, no `namespace` — they fail with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Declare the field and
  assign it; use string-literal unions or `as const` objects.
- No sleeps, no retries, no `waitForIdle()` between actions — every Driver call already waits.
- Assert with Quiesco assertions (`expectText`, `expectVisible`, `expectCount`, `expect(t).toHaveText`),
  which retry; a plain `assert` on `query()` is fine only right after an action.
- Branch per platform inside the driver with `this.app.platform`, not with separate steps.

## Vitest / Jest

```ts
// Vitest
import { test } from '@quiesco/vitest';
test('a new todo appears at the top', { tags: ['@web'] }, async ({ app }) => {
  await app.backdoor('loginAs', 'a@example.com');   // only a backdoor the app registers
  await app.tap('add-todo');
  await app.type('todo-title', 'Buy milk');
  await app.tap({ role: 'button', text: 'Save' });
  await app.expectText({ id: 'todo-item', index: 0 }, 'Buy milk');
});
```

Platform tags: Vitest takes them as the `{ tags: [...] }` test option; Jest has no test options, so they
go into `describe` / test titles (`test('… @ios', …)`). Jest uses the global `quiesco.app`. Setup details:
`${CLAUDE_PLUGIN_ROOT}/skills/quiesco-api/references/runners.md`.

## Verify the new test

1. Cucumber: `npx cucumber-js --dry-run` loads every step file without a device and catches undefined
   steps, import mistakes and unsupported TypeScript in seconds. Vitest / Jest: `npx quiesco list`
   (add `--runner …` when several runners are installed, and `--config …` as the project's scripts do).
2. Run only the new test on the cheapest available platform, normally web:
   `npx quiesco test --platform web features/todo.feature` (or `--tags @wip`, or the test file for
   Vitest / Jest). Prefer the project's `e2e:*` package.json script when it builds the web export first.
3. On failure, follow `/quiesco:debug` (read the evidence, fix the cause) instead of adding waits.

## Additional resources

- **`references/driver-pattern.md`** — the complete driver pattern: business driver, World, steps,
  per-platform branching, type-stripping rules, an API driver for the same features.
- **`references/steps.md`** — `@quiesco/steps` generic steps (zh / ja / en) and their exact wording.
- **`${CLAUDE_PLUGIN_ROOT}/skills/quiesco-api/references/api.md`** — matchers, assertions, backdoors.
