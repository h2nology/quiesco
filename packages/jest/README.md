# @quiesco/jest

Quiesco for Jest: a preset whose test environment runs one session for the run, resets the app before
every test and gives tests the global `quiesco`.

```sh
npm i -D @quiesco/jest @quiesco/core jest
```

```js
// jest.config.js
module.exports = { preset: '@quiesco/jest', maxWorkers: 1, testTimeout: 120_000 };

// e2e/todo.test.js
test('a new todo appears at the top @ios', async () => {
  await quiesco.app.tap('add-todo');
});
```

Platform tags go in test or `describe` titles. Run with `npx quiesco test --platform ios --runner jest`.
Details: [using Quiesco without Cucumber](https://github.com/h2nology/quiesco/blob/main/docs/api.md#using-quiesco-without-cucumber).

Part of [Quiesco](https://github.com/h2nology/quiesco): gray-box end-to-end testing for Expo apps on iOS, Android and the web. Setup: `npx quiesco init` ([quick start](https://github.com/h2nology/quiesco#quick-start-web-about-10-minutes)).

## License

MIT
