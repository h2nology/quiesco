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
    },
  },
  {
    files: ['**/*.cjs', '**/metro.config.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
