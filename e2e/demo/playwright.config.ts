// Playwright config for the MulmoClaude demo flow.
//
// This is intentionally distinct from `e2e/playwright.config.ts` —
// the regular CI e2e suite runs headless with retries and tiny
// timeouts, whereas the demo wants headed Chromium, a slowMo so the
// interaction is readable, WebM recording for later replay, and a
// generous test timeout because the demo stretches to three
// minutes by design.
//
// Run:
//   yarn demo:finance
// or directly:
//   npx playwright test --config e2e/demo/playwright.config.ts

import { defineConfig } from "@playwright/test";
import { ONE_SECOND_MS, ONE_MINUTE_MS } from "../../server/utils/time.ts";

export default defineConfig({
  testDir: ".",
  // The demo spec drives the full 3-minute flow in one pass — no
  // retries (a flake mid-recording would waste tape) and a test
  // timeout that comfortably covers the worst-case narrator pause.
  timeout: 5 * ONE_MINUTE_MS,
  retries: 0,
  use: {
    baseURL: "http://localhost:45173",
    headless: false,
    // Slow every action by 400 ms so the audience can follow the
    // cursor / typing / page transitions. Matches the timing the
    // canned agent event pacing was tuned against.
    launchOptions: { slowMo: 400 },
    video: {
      mode: "on",
      size: { width: 1280, height: 800 },
    },
    viewport: { width: 1280, height: 800 },
    // Trace is overkill for a demo — disable to keep the recording
    // dir tidy.
    trace: "off",
  },
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "yarn dev:client:e2e",
    port: 45173,
    reuseExistingServer: true,
    timeout: 15 * ONE_SECOND_MS,
    env: { MULMOCLAUDE_AUTH_TOKEN: "e2e-test-token" },
  },
});
