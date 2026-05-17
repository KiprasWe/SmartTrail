import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    env: {
      JWT_SECRET: "test-jwt-secret",
      JWT_EXPIRES_IN: "1h",
      ORS_API_KEY: "test-ors-key",
      GOOGLE_CLIENT_ID: "test-google-client-id",
      NODE_ENV: "test",
    },
  },
});
