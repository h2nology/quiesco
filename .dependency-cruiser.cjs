/**
 * Architecture rules (requirements.md §3, §5, §12). Run in CI: `pnpm depcruise`.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'core-no-test-runner',
      comment: '@quiesco/core must not depend on any test runner or on Playwright (§3-7, §5).',
      severity: 'error',
      from: { path: '^packages/core/src/' },
      to: { path: '(^|/node_modules/)(@cucumber|@playwright|playwright|playwright-core|jest|vitest|mocha)(/|$)' },
    },
    {
      name: 'core-no-adapter-packages',
      comment: '@quiesco/core must not depend on runner adapters or the web provider.',
      severity: 'error',
      from: { path: '^packages/core/src/' },
      to: { path: '^packages/(cucumber|jest|vitest|web|steps|cli)/' },
    },
    {
      name: 'cli-runs-cucumber-as-a-process',
      comment: 'quiesco (cli) starts the test runner (cucumber-js, Jest, Vitest) as a child process; it must not import one or Playwright.',
      severity: 'error',
      from: { path: '^packages/cli/src/' },
      to: { path: '(^|/node_modules/)(@cucumber|@playwright|playwright|playwright-core|jest|vitest|mocha)(/|$)' },
    },
    {
      name: 'no-playwright-test',
      comment: 'Use the `playwright` library, never `@playwright/test` (§5, §12).',
      severity: 'error',
      from: {},
      to: { path: '(^|/node_modules/)@playwright/test(/|$)' },
    },
    {
      name: 'renderer-internals-only-in-fiber-adapter',
      comment: 'Only agent/src/fiber-adapter may touch React Native renderer internals (§3-3, §12).',
      severity: 'error',
      from: { path: '^packages/agent/src/', pathNot: '^packages/agent/src/fiber-adapter/' },
      to: { path: 'react-native/Libraries/Renderer' },
    },
    {
      name: 'fiber-adapter-public-api-only',
      comment: 'Outside fiber-adapter, use only its index (HostNode etc.); Fiber shapes stay private (§3-3).',
      severity: 'error',
      from: { path: '^packages/agent/src/', pathNot: '^packages/agent/src/fiber-adapter/' },
      to: { path: '^packages/agent/src/fiber-adapter/(?!index\\.ts$)' },
    },
    {
      name: 'protocol-is-leaf',
      comment: '@quiesco/protocol contains only types and constants and depends on nothing in the repo.',
      severity: 'error',
      from: { path: '^packages/protocol/src/' },
      to: { path: '^packages/(?!protocol/)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|test)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default', 'types'] },
  },
};
