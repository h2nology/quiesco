// The example's Jest e2e tests (Phase 6.10): `pnpm test:jest` with QUIESCO_PLATFORM=ios|android|web.
// The preset gives the Quiesco test environment (global `quiesco`); a run needs one worker and a test
// timeout that covers Quiesco's own waits (presets cannot set these two).
module.exports = {
  preset: '@quiesco/jest',
  rootDir: __dirname,
  testMatch: ['<rootDir>/e2e/jest/**/*.test.js'],
  transform: {},
  maxWorkers: 1,
  testTimeout: 120_000,
  // The mock backend; the teardown also closes Quiesco's session (it replaces the preset's teardown).
  globalSetup: '<rootDir>/e2e/jest/global-setup.mjs',
  globalTeardown: '<rootDir>/e2e/jest/global-teardown.mjs',
};
