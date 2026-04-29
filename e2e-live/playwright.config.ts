import { defineConfig } from "@playwright/test";
import { ONE_MINUTE_MS } from "../server/utils/time.ts";

// e2e-live runs against a live mulmoclaude instance — *not* a
// self-contained suite like `e2e/`. The real Claude API is
// exercised end-to-end (no mockAllApis). Two boot modes are
// supported by overriding `E2E_LIVE_BASE_URL`:
//
//   - dev mode (default): the developer's `yarn dev` on
//     http://localhost:5173, used for routine regression checks
//   - pre-release mode: `npx mulmoclaude@<tarball>` (default port
//     3001), used to verify the published artifact behaves the
//     same way before a release goes out
//
// This config:
//   - assumes a live server is already up on `E2E_LIVE_BASE_URL`
//   - keeps full traces so failed runs can be replayed in the
//     trace viewer (`npx playwright show-trace ...`)
//   - defaults to headless; flip to headed with `HEADED=1` for QA
//     to watch the browser run a scenario step by step

const HEADED = process.env.HEADED === "1";

// Per-category output isolation. The parent /e2e-live skill writes
// into the bare directories; each /e2e-live-<category> skill sets
// E2E_LIVE_REPORT_SUBDIR=<category> so its run lives in its own
// subdirectory and does not stomp the parent's report.
const REPORT_SUBDIR = process.env.E2E_LIVE_REPORT_SUBDIR ?? "";
const REPORT_SUFFIX = REPORT_SUBDIR ? `/${REPORT_SUBDIR}` : "";

export default defineConfig({
  testDir: "./tests",
  outputDir: `../test-results-live${REPORT_SUFFIX}`,
  timeout: 10 * ONE_MINUTE_MS,
  // The mulmoclaude server processes chat sessions concurrently
  // (each Playwright worker gets its own session id), so running
  // multiple specs in parallel cuts wall time roughly linearly. 3
  // is a conservative ceiling that stays comfortably within Claude
  // subscription rate limits even when every scenario fires off a
  // long-running tool call.
  workers: 3,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: `../playwright-report-live${REPORT_SUFFIX}`, open: "on-failure" }]],
  use: {
    baseURL: process.env.E2E_LIVE_BASE_URL ?? "http://localhost:5173",
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
