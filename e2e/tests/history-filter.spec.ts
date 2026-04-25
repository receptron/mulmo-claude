// E2E for the session-history filter pills inside the side panel.
//
// The filter state is panel-local (not URL-backed) since /history
// went away. These tests pin the pill → list behavior so the pills
// keep doing their job as the panel UX evolves.

import { test, expect, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";

function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

test.describe("session-history filter pills", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("All is active when the panel first opens", async ({ page }) => {
    await page.goto("/chat");
    await page.getByTestId("session-history-toggle-off").click();

    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    // Class derived in the component: active pill gets bg-blue-600.
    await expect(page.getByTestId("session-filter-all")).toHaveClass(/bg-blue-600/);
  });

  test("clicking Unread highlights the pill", async ({ page }) => {
    await page.goto("/chat");
    await page.getByTestId("session-history-toggle-off").click();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();

    await page.getByTestId("session-filter-unread").click();

    await expect(page.getByTestId("session-filter-unread")).toHaveClass(/bg-blue-600/);
    await expect(page.getByTestId("session-filter-all")).not.toHaveClass(/bg-blue-600/);
  });

  test("Human pill keeps default-origin sessions visible", async ({ page }) => {
    await page.goto("/chat");
    await page.getByTestId("session-history-toggle-off").click();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();

    await page.getByTestId("session-filter-human").click();

    await expect(page.getByTestId("session-filter-human")).toHaveClass(/bg-blue-600/);
    // Default-origin sessions (no `origin` field) render as `human`
    // per `originOf`, so they remain visible under the Human filter.
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
  });

  test("switching filters updates the visible session set", async ({ page }) => {
    await page.route(urlEndsWith("/api/sessions"), (route: Route) => {
      return route.fulfill({
        json: {
          sessions: [
            { ...SESSION_A, origin: "bridge" },
            { ...SESSION_B, origin: "scheduler" },
          ],
          cursor: "v1:0",
          deletedIds: [],
        },
      });
    });

    await page.goto("/chat");
    await page.getByTestId("session-history-toggle-off").click();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();

    await page.getByTestId("session-filter-bridge").click();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeHidden();

    await page.getByTestId("session-filter-scheduler").click();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeHidden();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();

    await page.getByTestId("session-filter-all").click();
    await expect(page.getByTestId(`session-item-${SESSION_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`session-item-${SESSION_B.id}`)).toBeVisible();
  });

  test("closing and reopening the panel resets the filter to All", async ({ page }) => {
    // Panel-local filter state on purpose: reopening should land you
    // on the familiar "everything" view rather than remembering the
    // last narrow filter, which can be surprising after a break.
    await page.goto("/chat");
    await page.getByTestId("session-history-toggle-off").click();
    await page.getByTestId("session-filter-unread").click();
    await expect(page.getByTestId("session-filter-unread")).toHaveClass(/bg-blue-600/);

    // Close (dock toggle in panel header).
    await page.getByTestId("session-history-toggle-on").click();
    await expect(page.getByTestId("session-history-side-panel")).toBeHidden();

    // Reopen.
    await page.getByTestId("session-history-toggle-off").click();
    await expect(page.getByTestId("session-filter-all")).toHaveClass(/bg-blue-600/);
  });
});
