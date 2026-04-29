import { defineConfig } from "@playwright/test";
import { ONE_MINUTE_MS } from "../server/utils/time.ts";

// e2e-live runs against a live `yarn dev` instance on the default
// port 5173 — it is *not* a self-contained suite like `e2e/`. The
// real Claude API is exercised end-to-end (no mockAllApis), so this
// config:
//   - assumes the user already started `yarn dev`
//   - runs serially with workers=1 to respect API rate limits
//   - keeps full traces so failed runs can be replayed in the
//     trace viewer (`npx playwright show-trace ...`)
//   - defaults to headless; flip to headed with `HEADED=1` for QA
//     to watch the browser run a scenario step by step

const HEADED = process.env.HEADED === "1";

export default defineConfig({
  testDir: "./tests",
  outputDir: "../test-results-live",
  timeout: 10 * ONE_MINUTE_MS,
  // The mulmoclaude server processes chat sessions concurrently
  // (each Playwright worker gets its own session id), so running
  // multiple specs in parallel cuts wall time roughly linearly. 3
  // is a conservative ceiling that stays comfortably within Claude
  // subscription rate limits even when every scenario fires off a
  // long-running tool call.
  workers: 3,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "../playwright-report-live", open: "on-failure" }]],
  use: {
    baseURL: "http://localhost:5173",
    headless: !HEADED,
    launchOptions: { slowMo: HEADED ? 200 : 0 },
    trace: "on",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: ONE_MINUTE_MS,
    navigationTimeout: ONE_MINUTE_MS,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
