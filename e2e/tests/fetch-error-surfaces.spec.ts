import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// Regression net for issue #280 — every surface listed there must
// produce a visible, inline banner when its backing fetch fails, so
// the user can tell "server broken" apart from "nothing to show yet".
//
// We mock specific `/api/*` endpoints to return HTTP 500 *after* the
// shared `mockAllApis` has already registered its healthy catch-alls.
// Playwright matches routes in REVERSE registration order, so the
// per-test 500 override wins over the catch-all.

test.describe("fetch failure → inline error banner (#280)", () => {
  test("Settings modal: GET /api/config 500 shows loadError + disables Save", async ({ page }) => {
    await mockAllApis(page);

    // Make the config load fail. Registered AFTER mockAllApis so it
    // wins Playwright's last-registered-first match order over the
    // fixture's default 200 handler.
    await page.route(
      (url) => url.pathname === "/api/config",
      (route) => {
        if (route.request().method() === "GET") {
          return route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "config daemon is on fire" }),
          });
        }
        return route.fallback();
      },
    );

    await page.goto("/chat");
    // Arrange: wait for the failing GET to land before asserting on UI.
    const failedGet = page.waitForResponse((r) => r.url().includes("/api/config") && r.request().method() === "GET" && r.status() === 500);
    await page.locator('[data-testid="settings-btn"]').click();
    await failedGet;

    // Banner surfaces the server error (text is "Failed to load
    // settings (HTTP 500)" — the SettingsModal collapses server
    // messages to a canonical phrasing, so we assert on the HTTP code
    // instead of the raw body).
    const loadError = page.locator('[data-testid="settings-load-error"]');
    await expect(loadError).toBeVisible();
    await expect(loadError).toContainText("HTTP 500");

    // Save button must be disabled so the user can't submit the
    // (empty) default form over their real config.
    const saveBtn = page.locator('[data-testid="settings-save-btn"]');
    await expect(saveBtn).toBeDisabled();
  });

  test("SessionHistoryPanel: GET /api/sessions 500 shows error banner", async ({ page }) => {
    await mockAllApis(page);

    // Override the sessions list to return 500 on every call.
    await page.route(
      (url) => url.pathname === "/api/sessions",
      (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "sessions index corrupted" }),
        }),
    );

    await page.goto("/chat");

    // Open the history popup — this is what calls fetchSessions().
    const failedGet = page.waitForResponse((r) => r.url().includes("/api/sessions") && r.request().method() === "GET" && r.status() === 500);
    await page.locator('[data-testid="history-btn"]').click();
    await failedGet;

    const banner = page.locator('[data-testid="session-history-error"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("sessions index corrupted");
  });
});
