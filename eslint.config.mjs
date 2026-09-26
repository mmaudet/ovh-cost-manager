import globals from 'globals';

// Only what neither the build nor the tests catch: an undefined identifier
// builds fine with Vite and only throws once the code runs in the browser.
const rules = { 'no-undef': 'error' };

export default [
  {
    // The dashboard tests run in jsdom and import Vitest's functions
    files: ['dashboard/src/**/*.{js,jsx}', 'dashboard/test/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    rules,
  },
  {
    files: ['server/**/*.js', 'data/**/*.js', 'cli/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules,
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest },
    },
    rules,
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules,
  },
  {
    // Run inside the dashboard page by Playwright
    files: ['scripts/compare-dashboard/in-page.mjs'],
    languageOptions: { globals: globals.browser },
  },
];
