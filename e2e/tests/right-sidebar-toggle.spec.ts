// E2E for useRightSidebar — the button that opens/closes the Tool
// Call History sidebar, and the localStorage persistence of that
// preference. Companion to localstorage.spec.ts, which covers the
// reload path; this file covers the interactive toggle path.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.describe("right sidebar toggle (useRightSidebar)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("clicking the header button shows/hides the sidebar", async ({
    page,
  }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // The sidebar has a unique heading "Tool Call History" (h2).
    const sidebarHeading = page.getByRole("heading", {
      name: "Tool Call History",
    });
    await expect(sidebarHeading).toBeHidden();

    const toggleBtn = page.getByTitle("Tool call history");
    await toggleBtn.click();
    await expect(sidebarHeading).toBeVisible();

    await toggleBtn.click();
    await expect(sidebarHeading).toBeHidden();
  });

  test("toggle state persists to localStorage", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await page.getByTitle("Tool call history").click();
    await expect(
      page.getByRole("heading", { name: "Tool Call History" }),
    ).toBeVisible();

    const stored = await page.evaluate(() =>
      localStorage.getItem("right_sidebar_visible"),
    );
    expect(stored).toBe("true");

    // Close → stored becomes "false".
    await page.getByTitle("Tool call history").click();
    const stored2 = await page.evaluate(() =>
      localStorage.getItem("right_sidebar_visible"),
    );
    expect(stored2).toBe("false");
  });
});
