# @quiesco/vitest

Quiesco for Vitest: one session for the run, `app` as a test fixture, a reset before every test,
platform tags.

```sh
npm i -D @quiesco/vitest @quiesco/core vitest
```

```ts
// vitest.config.ts
import { quiesco } from '@quiesco/vitest/config';
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { ...quiesco(), include: ['e2e/**/*.test.ts'] } });

// e2e/todo.test.ts
import { test } from '@quiesco/vitest';

test('a new todo appears at the top', async ({ app }) => {
  await app.tap('add-todo');
  await app.expectText({ id: 'todo-item', index: 0 }, 'Buy milk');
});
```

Run with `npx quiesco test --platform ios --runner vitest`. Details:
[using Quiesco without Cucumber](https://shift-14cc7601.mintlify.site/api#using-quiesco-without-cucumber).

Part of [Quiesco](https://github.com/h2nology/quiesco): gray-box end-to-end testing for Expo apps on iOS, Android and the web. Setup: `npx quiesco init` ([quick start](https://github.com/h2nology/quiesco#quick-start-web-about-10-minutes)).

## License

MIT
