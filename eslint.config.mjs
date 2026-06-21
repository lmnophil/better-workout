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
  // Expected user-facing failures in server actions must be ExpectedError —
  // a plain Error's message gets redacted by the prod build before it reaches
  // the client, and withLogging would log it as a bug. Genuine invariant
  // violations can disable the rule locally with a justification.
  {
    // The directory glob is for a future split of actions.ts — the guard must
    // follow the files, not the filename.
    files: ['lib/actions.ts', 'lib/actions/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ThrowStatement > NewExpression[callee.name='Error']",
          message:
            'Throw ExpectedError (lib/action-result.ts) for user-facing failures — plain Error messages are redacted in production builds.',
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
