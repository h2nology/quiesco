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
# or jest, cucumber
npx quiesco init --runner vitest
```

`quiesco test`, `quiesco ui` and `quiesco list` then use the runner whose Quiesco package is installed, so
`--runner` is not needed. When several are installed (or none), they use Cucumber, as Quiesco 0.6 and
earlier did; `--runner` picks another.

## Setting one up {#setup}

Each runner has a page on its config:

- [Vitest](./vitest.md): vitest.config.mts, the quiesco() options and the app fixture
- [Jest](./jest.md): The preset, jest.config.cjs and the global quiesco
- [Cucumber](./cucumber.md): cucumber.mjs, registerQuiesco() options and the World

## Running {#running}

Run the tests with `npx quiesco test --platform ios` (`--runner vitest|jest|cucumber` to choose another than
the installed one), or from the browser with [`quiesco ui`](https://shift-14cc7601.mintlify.site/ui). All three are in
[examples/todo-app](https://github.com/h2nology/quiesco/tree/main/examples/todo-app); details in
[Vitest, Jest and other runners](./api.md#using-quiesco-without-cucumber), several devices at once in
[parallel runs](./parallel.md).
