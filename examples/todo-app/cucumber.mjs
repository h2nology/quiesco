export default {
  paths: ['features/**/*.feature'],
  import: ['features/support/**/*.ts', 'features/step_definitions/**/*.ts'],
  format: ['progress', 'html:reports/cucumber.html'],
};
