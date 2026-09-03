import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import js from '@eslint/js';

export default defineConfig(
  { ignores: ['dist/', 'node_modules/', 'test/fixtures/', '**/*.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['src/**/*.ts', 'src/**/*.cts', 'test/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: true }],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      '@typescript-eslint/array-type': ['warn', { default: 'array' }],
      curly: ['error', 'all'],
      'id-length': ['warn', { min: 2, exceptions: ['_', 'i', 'j', 'k', 'x', 'y', 'e'] }],
      'no-async-promise-executor': 'off',
      'no-console': 'off',
      'no-nested-ternary': 'error',
      'no-unneeded-ternary': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/**/*.cts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
