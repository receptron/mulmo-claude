import { defineConfig } from "@playwright/test";
import { ONE_SECOND_MS } from "../server/utils/time.ts";

export default defineConfig({
  testDir: "./tests",
  timeout: 30 * ONE_SECOND_MS,
  retries: 0,
  use: {
    // E2E runs on a dedicated port so a parallel `yarn dev` on the
    // default 5173 isn't disturbed by Playwright spinning up (or
    // reusing) a Vite instance. If you want to hit the e2e server
    // manually, it's http://localhost:45173 while the test is running.
    baseURL: "http://localhost:45173",
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
    // `dev:client:e2e` runs `vite --port 45173 --strictPort` so it
    // never collides with the default `yarn dev` on 5173. The user's
    // running dev server stays untouched.
    //
    // `reuseExistingServer: true` — if a previous test run left a
    // Vite on 45173 we reuse it. If something else is squatting the
    // port, `--strictPort` makes Vite fail fast instead of silently
    // hopping to 5175 and leaving Playwright talking to the wrong
    // server.
    command: "yarn dev:client:e2e",
    port: 45173,
    reuseExistingServer: true,
    timeout: 15 * ONE_SECOND_MS,
    // Inject a fixed bearer token into the dev HTML so tests can
    // assert the auth flow end-to-end without touching the real
    // user's `~/mulmoclaude/.session-token`. See
    // vite.config.ts#readDevToken and #272 Phase 1 plan.
    env: { MULMOCLAUDE_AUTH_TOKEN: "e2e-test-token" },
  },
});
