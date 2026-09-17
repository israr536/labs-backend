// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    files: ['test/**/*.ts', 'master-tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    files: [
      'src/tests/tests.service.ts',
      'src/final-reports/final-reports.service.ts',
      'src/final-reports/final-report-workflow.service.ts',
      'src/orders/orders.service.ts',
      'src/orders/optimized-orders.service.ts',
      'src/results/results.service.ts',
      'src/reports/pdf.service.ts',
      'src/reports/report-template.service.ts',
      'src/reports/reports.service.ts',
      'src/reference-ranges/reference-ranges.service.ts',
      'src/samples/samples.service.ts',
      'src/tests/starter-tests.service.ts',
      'src/tests/test-catalog.service.ts',
      'src/auth/auth.service.ts',
      'src/auth/auth.controller.ts',
      'src/auth/otp-delivery.service.ts',
      'src/auth/password-reset.service.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    files: [
      'src/audit/outbox.service.ts',
      'src/common/performance.interceptor.ts',
      'src/common/sanitized-exception.filter.ts',
      'src/labs/labs.service.spec.ts',
      'src/reference-ranges/reference-ranges.controller.ts',
      'src/results/results.controller.ts',
      'src/samples/samples.controller.ts',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    files: [
      'src/auth/auth.controller.ts',
      'src/auth/auth.service.ts',
      'src/auth/otp-delivery.service.ts',
      'src/orders/orders.service.ts',
      'src/orders/optimized-orders.service.ts',
      'src/orders/orders.service.ts',
      'src/reports/pdf.service.ts',
      'src/reports/report-template.service.ts',
      'src/reports/reports.service.ts',
      'src/samples/samples.service.ts',
      'src/tests/starter-tests.service.ts',
      'src/tests/test-catalog.service.ts',
      'src/tests/tests.service.ts',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-useless-catch': 'off',
    },
  },
  {
    files: [
      'src/reports/pdf.service.ts',
      'src/reports/report-template.service.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: [
      'src/common/performance.interceptor.ts',
      'src/final-reports/final-reports.service.ts',
    ],
    rules: {
      'prettier/prettier': 'off',
    },
  },
);
