// E2E for the session-history dropdown — the button-triggered popup
// that lists past sessions. Covers:
// - lazy fetch: /api/sessions is fetched when the button is clicked
// - click-outside guard: popup dismisses when clicking elsewhere
// - session click → navigate to /chat/:id
//
// Companion to chat-flow.spec.ts (which covers list sort order and
// AI-title preference): this file focuses on the button+popup UX
// extracted into useSessionHistory + SessionHistoryPanel.

import { test, expect, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";

function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

test.describe("history panel (useSessionHistory)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("clicking the history button opens the panel with server sessions", async ({
    page,
  }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Panel is closed initially — session items should not be in DOM.
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeHidden();

    await page.getByTestId("history-btn").click();

    await expect(
      page.getByTestId(`session-item-${SESSION_A.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`session-item-${SESSION_B.id}`),
    ).toBeVisible();
  });

  test("clicking a session navigates to /chat/:id", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await page.getByTestId("history-btn").click();
    await page.getByTestId(`session-item-${SESSION_A.id}`).click();

    await expect(page).toHaveURL(new RegExp(`/chat/${SESSION_A.id}`));
  });

  test("clicking outside closes the panel", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await page.getByTestId("history-btn").click();
    const item = page.getByTestId(`session-item-${SESSION_A.id}`);
    await expect(item).toBeVisible();

    // Click somewhere neutral (main chat canvas area, far from the header).
    await page.locator("body").click({ position: { x: 600, y: 500 } });
    await expect(item).toBeHidden();
  });

  test("button click triggers a fresh /api/sessions fetch", async ({
    page,
  }) => {
    // Count /api/sessions GETs so we can verify the button fires a
    // lazy fetch (not just the onMount one).
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

    await page.getByTestId("history-btn").click();
    await expect(
      page.getByTestId(`session-item-${SESSION_A.id}`),
    ).toBeVisible();

    // One additional fetch should have happened on button click.
    expect(sessionFetchCount).toBeGreaterThan(countAfterMount);
  });
});
