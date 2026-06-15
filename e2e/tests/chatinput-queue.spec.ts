// E2E coverage for the queued-send feature
// (plans/feat-chat-input-queued-send.md).
//
// When the active session is already running, the send button used to
// be disabled. The new behaviour lets the user submit a follow-up
// anyway; the message + any attachments are pushed onto a queue and
// the watcher in App.vue flushes them once the run goes idle.
//
// Driving "an in-flight run" deterministically without a backend is
// hard, so we stub /api/sessions with `isRunning: true` and verify
// the send-button → queue-panel relationship at the UI level. The
// flush-on-idle behaviour is exercised by the unit-level reactivity
// of the watcher; no need to fake an SSE flip here.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const SESSION_ID = "queued-session";
const SESSION_PATH = `/chat/${SESSION_ID}`;

async function stubRunningSession(page: import("@playwright/test").Page) {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID,
        title: "Queued Session",
        roleId: "general",
        startedAt: "2026-04-12T10:00:00Z",
        updatedAt: "2026-04-12T10:05:00Z",
        isRunning: true,
      },
    ],
  });
  // The session transcript matters only for the page not to error;
  // an empty list is enough to make ChatInput render.
  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [{ type: "session_meta", roleId: "general", sessionId: SESSION_ID }],
      }),
  );
}

test.describe("ChatInput queued send", () => {
  test.beforeEach(async ({ page }) => {
    await stubRunningSession(page);
    await page.goto(SESSION_PATH);
  });

  test("send button stays enabled while a run is in flight", async ({ page }) => {
    // Pre-PR the button carried `:disabled="isRunning"`. The queued-send
    // refactor relaxed it so users can submit follow-ups during a run.
    const sendBtn = page.getByTestId("send-btn");
    await expect(sendBtn).toBeVisible();
    await expect(sendBtn).toBeEnabled();
  });

  test("clicking send while running pushes the message onto the queue panel", async ({ page }) => {
    // Queue is hidden until the user actually adds an entry.
    await expect(page.getByTestId("queued-messages-panel")).toHaveCount(0);

    await page.getByTestId("user-input").fill("follow-up while running");
    await page.getByTestId("send-btn").click();

    const panel = page.getByTestId("queued-messages-panel");
    await expect(panel).toBeVisible();
    const items = page.getByTestId("queued-message-item");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("follow-up while running");

    // The input box clears once the message rides into the queue so a
    // second submission is unambiguously a NEW queue entry, not a
    // re-send of the visible text.
    await expect(page.getByTestId("user-input")).toHaveValue("");
  });

  test("the × button removes a queued entry", async ({ page }) => {
    await page.getByTestId("user-input").fill("first queued");
    await page.getByTestId("send-btn").click();
    await page.getByTestId("user-input").fill("second queued");
    await page.getByTestId("send-btn").click();

    await expect(page.getByTestId("queued-message-item")).toHaveCount(2);

    await page.getByTestId("queued-message-remove").first().click();
    await expect(page.getByTestId("queued-message-item")).toHaveCount(1);
    await expect(page.getByTestId("queued-message-item").first()).toContainText("second queued");
  });
});
