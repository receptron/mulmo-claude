import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "yarn dev:client",
    port: 5173,
    reuseExistingServer: true,
    timeout: 15_000,
    // Inject a fixed bearer token into the dev HTML so tests can
    // assert the auth flow end-to-end without touching the real
    // user's `~/mulmoclaude/.session-token`. See
    // vite.config.ts#readDevToken and #272 Phase 1 plan.
    env: { MULMOCLAUDE_AUTH_TOKEN: "e2e-test-token" },
  },
});
