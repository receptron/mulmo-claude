// E2E for the /history filter pill ↔ URL path param (#677).
//
// Clicking a pill pushes a new entry onto browser history, so back /
// forward restore the prior filter state and deep links like
// /history/unread open the panel with that pill already active.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A } from "../fixtures/sessions";

test.describe("/history filter URL", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("landing on /history shows the All filter active", async ({ page }) => {
    await page.goto("/history");
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    // Class derived in the component: active pill gets bg-blue-500.
    await expect(page.getByTestId("session-filter-all")).toHaveClass(/bg-blue-500/);
  });

  test("clicking the Unread pill updates the URL to /history/unread", async ({ page }) => {
    await page.goto("/history");
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();

    await page.getByTestId("session-filter-unread").click();

    await expect(page).toHaveURL(/\/history\/unread$/);
    await expect(page.getByTestId("session-filter-unread")).toHaveClass(/bg-blue-500/);
  });

  test("clicking the Human pill updates the URL to /history/human", async ({ page }) => {
    await page.goto("/history");
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();

    await page.getByTestId("session-filter-human").click();

    await expect(page).toHaveURL(/\/history\/human$/);
    await expect(page.getByTestId("session-filter-human")).toHaveClass(/bg-blue-500/);
    // Default-origin sessions (no `origin` field) render as `human`
    // per `originOf`, so they remain visible under the Human filter.
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
  });

  test("browser back restores the prior filter state", async ({ page }) => {
    await page.goto("/history");
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();

    await page.getByTestId("session-filter-unread").click();
    await expect(page).toHaveURL(/\/history\/unread$/);

    await page.getByTestId("session-filter-human").click();
    await expect(page).toHaveURL(/\/history\/human$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/history\/unread$/);
    await expect(page.getByTestId("session-filter-unread")).toHaveClass(/bg-blue-500/);

    await page.goBack();
    await expect(page).toHaveURL(/\/history$/);
    await expect(page.getByTestId("session-filter-all")).toHaveClass(/bg-blue-500/);
  });

  test("clicking the All pill from /history/unread returns to bare /history", async ({ page }) => {
    await page.goto("/history/unread");
    // Fixtures aren't flagged unread, so no session rows render here.
    // Wait on the filter bar itself instead of a session item.
    await expect(page.getByTestId("session-filter-bar")).toBeVisible();
    await expect(page.getByTestId("session-filter-unread")).toHaveClass(/bg-blue-500/);

    await page.getByTestId("session-filter-all").click();

    await expect(page).toHaveURL(/\/history$/);
    await expect(page.getByTestId("session-filter-all")).toHaveClass(/bg-blue-500/);
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
  });

  test("deep link to /history/scheduler opens with Scheduler pill active", async ({ page }) => {
    await page.goto("/history/scheduler");
    // Default fixtures are human-origin, so the Scheduler filter
    // shows no matching sessions. We only assert the active-pill
    // state + filter-bar rendering, not a specific session row.
    await expect(page.getByTestId("session-filter-bar")).toBeVisible();
    await expect(page.getByTestId("session-filter-scheduler")).toHaveClass(/bg-blue-500/);
  });

  test("history close button from a deep filter pushes forward to the pre-history page", async ({ page }) => {
    // "Close" is an explicit user intent — it pushes a new history
    // entry rather than unwinding, so (a) one click closes the whole
    // /history section regardless of how many filters were traversed,
    // and (b) browser back from the closed state still reveals the
    // last filter the user was viewing.
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);
    const priorUrl = page.url();

    await page.getByTestId("history-btn").click();
    await expect(page).toHaveURL(/\/history$/);

    await page.getByTestId("session-filter-unread").click();
    await expect(page).toHaveURL(/\/history\/unread$/);

    await page.getByTestId("session-filter-human").click();
    await expect(page).toHaveURL(/\/history\/human$/);

    // One click closes the whole /history section.
    await page.getByTestId("history-btn").click();
    await expect(page).toHaveURL(priorUrl);

    // Browser back from the closed state still reveals the last filter.
    await page.goBack();
    await expect(page).toHaveURL(/\/history\/human$/);
  });
});
