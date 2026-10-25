import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.cache/**', 'dist/**', 'apps/desktop/dist/**', 'artifacts/**', 'apps/desktop/native/build/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  ...tseslint.configs.recommended,
  { files: ['**/*.ts', '**/*.tsx'], rules: { '@typescript-eslint/consistent-type-imports': 'error' } }
);
