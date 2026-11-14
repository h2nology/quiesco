# @quiesco/cucumber

cucumber-js World and hooks for Quiesco: one session for the run, a reset before every scenario,
`this.app` in step definitions, platform tags (`@ios`, `@android`, `@web`, `@native`) and evidence
(screenshot, element tree, idle state) attached to failed scenarios.

```sh
npm i -D @quiesco/cucumber @cucumber/cucumber
```

```ts
// features/support/quiesco.ts
import '@quiesco/cucumber/register';

// features/step_definitions/todo.steps.ts
import { When } from '@cucumber/cucumber';
import type { QuiescoWorld } from '@quiesco/cucumber';

When('they add a todo {string}', async function (this: QuiescoWorld, title: string) {
  await this.app.tap('add-todo');                 // waits until the app is idle, then taps
  await this.app.type('todo-title', title);
});
```

Run with `npx quiesco test --platform ios|android|web`. [API reference](https://github.com/h2nology/quiesco/blob/main/docs/api.md),
[driver pattern](https://github.com/h2nology/quiesco/blob/main/docs/driver-pattern.md), [parallel runs](https://github.com/h2nology/quiesco/blob/main/docs/parallel.md).

Part of [Quiesco](https://github.com/h2nology/quiesco): gray-box end-to-end testing for Expo apps on iOS, Android and the web. Setup: `npx quiesco init` ([quick start](https://github.com/h2nology/quiesco#quick-start-web-about-10-minutes)).

## License

MIT
