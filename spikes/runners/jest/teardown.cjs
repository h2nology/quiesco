// globalTeardown: same process as the tests with --runInBand; same module instance as the environment?
module.exports = async () => require('./environment.cjs').dispose();
