<!-- Generated from docs/cucumber.mdx by scripts/build-plugin-refs.mjs — do not edit. -->

# Cucumber

Set up @quiesco/cucumber: cucumber.mjs, the support file, registerQuiesco() options and the World.
`@quiesco/cucumber` runs Gherkin features with cucumber-js. Steps reach the app through `this.app`. It
needs `@cucumber/cucumber` 12 or later.

## Setup {#setup}

`quiesco init --runner cucumber` installs `@quiesco/cucumber` and `@cucumber/cucumber`, and writes:

| File | What it is |
|---|---|
| `cucumber.mjs` | The cucumber-js config |
| `features/package.json` | `{ "type": "module" }`: step files are ES modules |
| `features/support/quiesco.ts` | Registers the World and the lifecycle hooks |
| `features/app.feature` | A first scenario |
| `features/step_definitions/app.steps.ts` | Its step |

It also adds `"allowImportingTsExtensions": true` to `tsconfig.json`, because step files import each other
with `.ts` (see [TypeScript](#typescript)).

```js
// cucumber.mjs
export default {
  import: ['features/support/**/*.ts', 'features/step_definitions/**/*.ts'],
  format: ['progress'],
};
```

Features are read from `features/**/*.feature`, cucumber-js's default. Do not set `paths` here: paths from
the config are merged with the ones on the command line, so `quiesco test features/x.feature` would run
every feature.

```ts
// features/support/quiesco.ts
import '@quiesco/cucumber/register';
```

```ts
// features/step_definitions/app.steps.ts
import { Then } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';

Then('the home screen is visible', async function (this: QuiescoWorld) {
  await this.app.expectVisible({ id: 'home' });
});
```

## `registerQuiesco()` {#register-quiesco}

`import '@quiesco/cucumber/register'` registers everything with the defaults. To change them, call
`registerQuiesco()` in the support file instead (not both):

```ts
// features/support/quiesco.ts
import { registerQuiesco } from '@quiesco/cucumber';

import { TodoWorld } from './todo-world.ts';

registerQuiesco({ world: TodoWorld, stepTimeoutMs: 90_000 });
```

- **`world`** (`class extending QuiescoWorld`, default `QuiescoWorld`):
  Your own World (see [below](#world)).

- **`stepTimeoutMs`** (`number`, default `60000`):
  The default timeout of a step. Each Driver call has its own sync timeout; this caps the whole step.

- **`setupTimeoutMs`** (`number`, default `600000`):
  Timeout of the `BeforeAll` hook that starts the session. Booting an emulator can take minutes.

- **`resetTimeoutMs`** (`number`, default `180000`):
  Timeout of the reset before each scenario. It can start the app again when it is gone, which waits up to
  three times the connect timeout.

It registers four hooks:

| Hook | What it does |
|---|---|
| `BeforeAll` | Starts the session: server, device, install, launch, connect |
| `Before` | Skips a scenario tagged for another platform or browser; otherwise resets the app |
| `After` | On failure, writes the evidence and attaches it to the report |
| `AfterAll` | Closes the session |

## The World {#world}

`QuiescoWorld` gives every step:

- `this.app`: the [Driver](./api.md#driver-thisapp).
- `this.platform`: `'ios'`, `'android'` or `'web'`, for a step that does the same thing differently per
  platform. Scenarios for one platform only are better tagged (`@ios`, …).
- `this.session`: the session, for what the Driver does not cover.

To add your own business driver, extend it and pass it as `world`:

```ts
// features/support/todo-world.ts
import { QuiescoWorld } from '@quiesco/cucumber';

import { TodoDriver } from './todo-driver.ts';

export class TodoWorld extends QuiescoWorld {
  get todos() {
    return new TodoDriver(this.app);
  }
}
```

More in [the driver pattern](../../writing-tests/references/driver-pattern.md). Ready-made generic steps for prototyping are in
[generic steps](../../writing-tests/references/steps.md).

## TypeScript {#typescript}

Step and support files run with Node's type stripping, not `tsc`:

- Relative imports name the `.ts` file: `import { TodoDriver } from './todo-driver.ts'`.
- TypeScript syntax that generates code is not supported: parameter properties
  (`constructor(private app: Driver)`), `enum`, `namespace`. Declare fields instead.

## Tags {#tags}

Platform and browser tags go on the feature, a `Rule`, the scenario or an `Examples` block; the innermost
one decides ([scenario tags](./api.md#scenario-tags)). `@hard-reset` relaunches the app before that scenario.

## Running {#running}

```sh
npx quiesco test --platform ios
```

`quiesco test` sets `QUIESCO_PLATFORM`, runs `cucumber-js` and adds Quiesco's progress formatter by itself;
other arguments go to cucumber-js, e.g. `--tags @smoke` or a feature file
([`quiesco test`](../../setup/references/cli.md#quiesco-test)). `--workers N` becomes `--parallel N`: N worker threads, each with
a session and a device of its own ([parallel runs](./parallel.md)).
