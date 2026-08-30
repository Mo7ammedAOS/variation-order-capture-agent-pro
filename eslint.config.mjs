import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'src/generated/**', 'next-env.d.ts'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    /**
     * Type-aware linting, on the services only.
     *
     * `assertProjectAccess` and `assertCapability` became async when authority
     * moved into the database, and an unawaited call to either is a floating
     * promise that throws into nothing — the guard reads correctly, compiles
     * cleanly, and stops guarding. One such call shipped in project.service
     * before this rule existed.
     *
     * Scoped here rather than repo-wide because type-aware rules are slow and
     * this is where being wrong means someone reads another project's data.
     */
    files: ['src/services/**/*.ts', 'src/lib/api.ts', 'src/app/api/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
];

export default eslintConfig;
