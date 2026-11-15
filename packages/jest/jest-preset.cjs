// `preset: '@quiesco/jest'`: the Quiesco test environment, the teardown that closes the session, and the
// reporter that sends the run's progress to `quiesco test` / `quiesco ui` (a config with its own
// `reporters` replaces these: add '@quiesco/jest/reporter' there).
// Set `maxWorkers` (1 = serial; N = N devices in parallel) and a `testTimeout` in your own config (Jest
// presets cannot set them).
module.exports = {
  testEnvironment: require.resolve('./dist/environment.js'),
  globalTeardown: require.resolve('./dist/teardown.js'),
  reporters: ['default', require.resolve('./dist/reporter.js')],
};
