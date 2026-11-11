// The generic steps of @quiesco/steps on the example app, in Chinese, Japanese and English (Phase 6.10):
//   npx cucumber-js --config cucumber.steps.mjs   (QUIESCO_PLATFORM=ios|android|web)
export default {
  paths: ['features-generic/**/*.feature'],
  import: ['features/support/mock-server.ts', 'features-generic/support/**/*.ts'],
  format: ['progress'],
};
