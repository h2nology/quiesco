// The example's Jest e2e tests (Phase 6.10): `pnpm test:jest` with QUIESCO_PLATFORM=ios|android|web.
// The preset gives the Quiesco test environment (global `quiesco`); the config sets the number of workers
// (one device each) and a test timeout that covers Quiesco's own waits (presets cannot set these two).
module.exports = {
  preset: '@quiesco/jest',
  rootDir: __dirname,
  testMatch: ['<rootDir>/e2e/jest/**/*.test.js'],
  transform: {},
  // QUIESCO_WORKERS=N (or `--maxWorkers N`) runs the files on N devices in parallel (Phase 6.12).
  maxWorkers: Number(process.env.QUIESCO_WORKERS ?? 1),
  testTimeout: 120_000,
  // The mock backends (one per worker); the teardown also closes Quiesco's session (it replaces the preset's).
  globalSetup: '<rootDir>/e2e/jest/global-setup.mjs',
  globalTeardown: '<rootDir>/e2e/jest/global-teardown.mjs',
};
