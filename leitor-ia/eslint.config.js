// eslint.config.js - Flat config for ESLint v9+
import js from '@eslint/js';
import globals from 'globals';

const browserGlobals = {
  ...globals.browser,
  ...globals.es2022,
  chrome: 'readonly',
  PROVIDERS: 'readonly',
  EFFORTS: 'readonly',
  globalThis: 'readonly'
};

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
        vi: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        globalThis: 'readonly'
      }
    },
    rules: {
      'no-empty': ['warn', { allowEmptyCatch: true }]
    }
  }
];