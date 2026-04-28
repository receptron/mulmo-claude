// E2E for the session-history side panel. Covers:
// - toggle opens / closes the panel
// - opening the panel triggers a fresh /api/sessions fetch
// - clicking a session row navigates to /chat/:id
// - filter bar pills hide non-matching sessions without leaving the panel
//
// Scope-matching note: the panel used to live at /history. That route
// is gone — the filter bar is now panel-local state, and tests that
// asserted URL shape have been retired in favor of DOM assertions.

import { test, expect, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";

function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

test.describe("session-history side panel", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("toggling the button opens the panel with server sessions", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Panel is closed initially — session items should not be in DOM.
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeHidden();

    await page.getByTestId("session-history-toggle-off").click();

    await expect(page.getByTestId("session-history-side-panel")).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();
  });

  test("clicking a session navigates to /chat/:id and closes nothing", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await page.getByTestId("session-history-toggle-off").click();
    await page.getByTestId(`session-item-${SESSION_A.id}`).click();

    await expect(page).toHaveURL(new RegExp(`/chat/${SESSION_A.id}`));
  });

  test("toggle click triggers a fresh /api/sessions fetch", async ({ page }) => {
    // Count /api/sessions GETs so we can verify opening the panel
    // fires a lazy fetch on top of the initial onMount one.
    let sessionFetchCount = 0;
    await page.route(urlEndsWith("/api/sessions"), (route: Route) => {
      if (route.request().method() === "GET") {
        sessionFetchCount++;
      }
      return route.fulfill({
        json: {
          sessions: [SESSION_A, SESSION_B],
          cursor: "v1:0",
          deletedIds: [],
        },
      });
    });

    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    // Let onMount fetches settle.
    await page.waitForTimeout(200);
    const countAfterMount = sessionFetchCount;

    await page.getByTestId("session-history-toggle-off").click();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();

    // One additional fetch should have happened on panel open.
    expect(sessionFetchCount).toBeGreaterThan(countAfterMount);
  });

  test("filter bar is visible with All/Unread/Human/Scheduler/Skill/Bridge buttons", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await page.getByTestId("session-history-toggle-off").click();

    const filterBar = page.getByTestId("session-filter-bar");
    await expect(filterBar).toBeVisible();

    await expect(page.getByTestId("session-filter-all")).toBeVisible();
    await expect(page.getByTestId("session-filter-unread")).toBeVisible();
    await expect(page.getByTestId("session-filter-human")).toBeVisible();
    await expect(page.getByTestId("session-filter-scheduler")).toBeVisible();
    await expect(page.getByTestId("session-filter-skill")).toBeVisible();
    await expect(page.getByTestId("session-filter-bridge")).toBeVisible();
  });

  test("clicking a filter hides non-matching sessions without leaving the panel", async ({ page }) => {
    // Override sessions with origin data
    await page.route(urlEndsWith("/api/sessions"), (route: Route) =>
      route.fulfill({
        json: {
          sessions: [
            { ...SESSION_A, origin: "bridge" },
            { ...SESSION_B }, // no origin = human
          ],
          cursor: "v1:0",
          deletedIds: [],
        },
      }),
    );

    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await page.getByTestId("session-history-toggle-off").click();
    // Both visible initially
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();

    // Click Bridge filter — panel stays open, only bridge sessions remain.
    await page.getByTestId("session-filter-bridge").click();
    await expect(page.getByTestId("session-history-side-panel")).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeHidden();

    // Click All to reset
    await page.getByTestId("session-filter-all").click();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();
  });
});
