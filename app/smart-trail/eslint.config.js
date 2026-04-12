// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      // Disallow console.log in production-shipped code; warn/error are OK for
      // deliberate diagnostics that should be reviewed before shipping.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
]);
