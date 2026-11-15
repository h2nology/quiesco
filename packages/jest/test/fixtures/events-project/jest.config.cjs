// A user project for the run-events test: node environment (no device), Quiesco's reporter next to 'default'.
const path = require('node:path');

module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.e2e.js'],
  reporters: ['default', path.resolve(__dirname, '../../../dist/reporter.js')],
  cacheDirectory: path.join(require('node:os').tmpdir(), 'quiesco-jest-events-fixture'),
};
