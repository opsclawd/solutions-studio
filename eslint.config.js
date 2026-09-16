import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/.ai-tmp/**',
      '**/.ai-worktrees/**',
      '**/.ai-runs/**',
      // Deliberately adversarial/malformed test payloads (security fixtures, an
      // intentionally-broken-syntax compile-error fixture) used as test data, not
      // application code meant to satisfy lint rules.
      '**/test/fixtures/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['**/*.cjs', '**/*.config.js', '**/*.config.mjs'],
    languageOptions: { globals: { module: 'writable', require: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    // Test code legitimately needs `any` for dynamically-executed generated code
    // (`new Function(...)`) and ad-hoc attacker-injected browser globals in
    // security fixtures; application src keeps the strict rule.
    files: ['**/test/**/*.ts', '**/test/**/*.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' }
  }
);
