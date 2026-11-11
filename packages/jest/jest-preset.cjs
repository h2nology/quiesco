// `preset: '@quiesco/jest'`: the Quiesco test environment and the teardown that closes the session.
// Set `maxWorkers: 1` and a `testTimeout` in your own config (Jest presets cannot set them).
module.exports = {
  testEnvironment: require.resolve('./dist/environment.js'),
  globalTeardown: require.resolve('./dist/teardown.js'),
};
