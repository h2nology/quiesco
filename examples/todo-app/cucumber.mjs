// Scenarios the run cannot drive are left out by tag: real touches (@needs-touch) need the native
// action mode (QUIESCO_ACTION_MODE=js has none), and two-finger gestures (@multi-touch) need a touch
// screen, which the web desktop viewport (QUIESCO_VIEWPORT=desktop) does not have.
const excluded = [
  ...(process.env['QUIESCO_ACTION_MODE'] === 'js' ? ['@needs-touch'] : []),
  ...(process.env['QUIESCO_PLATFORM'] === 'web' && process.env['QUIESCO_VIEWPORT'] === 'desktop' ? ['@multi-touch'] : []),
];

export default {
  import: ['features/support/**/*.ts', 'features/step_definitions/**/*.ts'],
  format: ['progress', 'html:reports/cucumber.html'],
  ...(excluded.length > 0 ? { tags: excluded.map((t) => `not ${t}`).join(' and ') } : {}),
};
