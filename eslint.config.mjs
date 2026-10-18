import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const RELATIVE_IMPORT_PATTERN = {
  regex: '^\\.\\.?(/|$)',
  message: 'Import through an alias: @/…, @test-helpers/… or @package.json.',
};

const INDEX_IMPORT_PATTERN = {
  regex: '/index$',
  message: 'Drop the trailing /index: import the folder.',
};

function getModuleFolders(layer) {
  const layerPath = join(import.meta.dirname, 'src', layer);
  return readdirSync(layerPath, { withFileTypes: true })
    .filter((entry) => existsSync(join(layerPath, entry.name, 'index.ts')))
    .map((entry) => {
      const folder = `${layer}/${entry.name}`;
      return {
        files: [`src/${folder}/**/*.ts`],
        pattern: {
          regex: `^@/${folder}/`,
          message: `Import through the barrel: @/${folder}.`,
        },
      };
    });
}

function getRestrictedImportsRule(patterns) {
  return {
    'no-restricted-imports': [
      'error',
      { patterns: [RELATIVE_IMPORT_PATTERN, INDEX_IMPORT_PATTERN, ...patterns] },
    ],
  };
}

const moduleFolders = ['commands', 'domains', 'lib'].flatMap(getModuleFolders);

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
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
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: getRestrictedImportsRule(moduleFolders.map((folder) => folder.pattern)),
  },
  // Flat config doesn't merge rule options: a folder's own block comes later and replaces the
  // general one, which is what opens the folder's internals to its own files.
  ...moduleFolders.map((folder) => ({
    files: folder.files,
    rules: getRestrictedImportsRule(
      moduleFolders.filter((other) => other !== folder).map((other) => other.pattern),
    ),
  })),
);
