const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: [
      'dist/**',
      'docs/official/.vitepress/cache/**',
      'docs/official/.vitepress/dist/**',
      '.expo/**',
      'coverage/**',
    ],
  },
]);
