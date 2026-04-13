import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.describe("LockStatusPopup", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("clicking the lock button opens the popup", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    const lockBtn = page.getByTestId("sandbox-lock-button");
    await expect(lockBtn).toBeVisible();

    // Popup is not visible initially.
    await expect(page.getByTestId("sandbox-test-query").first()).toBeHidden();

    await lockBtn.click();

    // Sandbox test query buttons appear.
    const queries = page.getByTestId("sandbox-test-query");
    await expect(queries.first()).toBeVisible();
    expect(await queries.count()).toBe(4);
  });

  test("clicking a test query closes the popup", async ({ page }) => {
    // Block the agent route so sendMessage doesn't try to stream —
    // we only care that the popup closes after the click.
    await page.route(
      (url) => url.pathname === "/api/agent",
      (route) => route.fulfill({ status: 500, body: "" }),
    );

    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByTestId("sandbox-lock-button").click();

    const firstQuery = page.getByTestId("sandbox-test-query").first();
    await expect(firstQuery).toBeVisible();
    await firstQuery.click();

    await expect(firstQuery).toBeHidden();
  });

  test("clicking outside closes the popup", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByTestId("sandbox-lock-button").click();

    const firstQuery = page.getByTestId("sandbox-test-query").first();
    await expect(firstQuery).toBeVisible();

    // Click somewhere neutral (the main chat area, not the button /
    // popup) — the click-outside guard should close the popup.
    await page.locator("body").click({ position: { x: 400, y: 400 } });

    await expect(firstQuery).toBeHidden();
  });
});
