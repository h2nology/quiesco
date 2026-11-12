module.exports = { rootDir: __dirname, testEnvironment: '<rootDir>/env.mjs', testMatch: ['<rootDir>/tests/*.test.js'], transform: {}, maxWorkers: 2, globalTeardown: '<rootDir>/teardown.mjs' };
