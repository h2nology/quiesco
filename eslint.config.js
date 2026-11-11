import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'spikes/**', 'examples/**/android/**', 'examples/**/ios/**', 'examples/**/.expo/**', 'examples/**/reports/**', '.planning/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      // Monkey-patching wrappers need both the caller's `this` and the tracker; `self` names the latter.
      '@typescript-eslint/no-this-alias': ['error', { allowedNames: ['self'] }],
      // `_name` marks a deliberately unused parameter (test doubles mirroring a real signature).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Jest e2e tests: Jest's globals and the `quiesco` global of @quiesco/jest.
    files: ['examples/**/e2e/jest/**/*.test.js'],
    languageOptions: { globals: { ...globals.jest, quiesco: 'readonly' } },
  },
  {
    files: ['**/*.cjs', '**/metro.config.js', '**/app.plugin.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
