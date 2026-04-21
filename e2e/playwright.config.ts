import { defineConfig } from "@playwright/test";
import { ONE_SECOND_MS } from "../server/utils/time.ts";

const port = Number(process.env.VITE_PORT) || 8000;

export default defineConfig({
  testDir: "./tests",
  timeout: 30 * ONE_SECOND_MS,
  retries: 0,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "webkit",
      use: { browserName: "webkit" },
      testMatch: "ime-enter.spec.ts",
    },
  ],
  webServer: {
    command: "yarn dev:client",
    port,
    reuseExistingServer: true,
    timeout: 15 * ONE_SECOND_MS,
    // Inject a fixed bearer token into the dev HTML so tests can
    // assert the auth flow end-to-end without touching the real
    // user's `~/mulmoclaude/.session-token`. See
    // vite.config.ts#readDevToken and #272 Phase 1 plan.
    env: { MULMOCLAUDE_AUTH_TOKEN: "e2e-test-token" },
  },
});
