import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config({ ignores: ['dist/**', 'node_modules/**'] }, js.configs.recommended, {
  // Type-aware rules stay scoped to .ts — spread at top level they would apply to
  // this file, which is in no tsconfig, and ESLint would abort.
  files: ['**/*.ts'],
  extends: [tseslint.configs.recommendedTypeChecked],
  languageOptions: {
    globals: globals.node,
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    // A leading `_` marks a binding that exists to be discarded — the omitted key
    // in a rest destructuring, an argument kept only to reach a later one.
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      },
    ],
  },
});
