// Quiesco's e2e tests. The preset: the Quiesco test environment (the global `quiesco`) and the reporter for
// `quiesco test` / `quiesco ui`. maxWorkers: N runs the files on N devices; testTimeout covers Quiesco's waits.
module.exports = {
  preset: '@quiesco/jest',
  rootDir: __dirname,
  testMatch: ['<rootDir>/e2e/**/*.test.js'],
  transform: {},
  maxWorkers: 1,
  testTimeout: 120_000,
};
