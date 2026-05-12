import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-config-next still ships legacy eslintrc-style configs, so we bridge
// them through FlatCompat. The Next 16 codemod produces the same shape.
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'prisma/generated/**',
      'public/sw.js',
      'public/sw.js.map',
      'public/swe-worker-*.js',
      'public/workbox-*.js',
      'next-env.d.ts',
      'backups/**',
      '.playwright-profile/**',
      '.playwright-mcp/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  ...tseslint.configs.strict,
  {
    rules: {
      // Allow `_`-prefixed unused args/vars — common pattern for intentionally
      // ignored parameters in callbacks and destructuring.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // CommonJS files (healthcheck.cjs runs in the Docker container outside the
  // Next build) need `require()`.
  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Config files conventionally use `export default {...}` without a named
  // intermediate. Don't bug us about it.
  {
    files: ['*.config.{js,mjs,cjs,ts}', 'eslint.config.mjs'],
    rules: {
      'import/no-anonymous-default-export': 'off',
    },
  },
  prettier,
];

export default config;
