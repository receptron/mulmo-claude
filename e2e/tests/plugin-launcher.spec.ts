// Plugin launcher buttons that sit above the canvas. All buttons
// navigate to a dedicated page (/todos, /wiki, etc.) — the URL path
// reflects which page is active, and landing on that URL restores it.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

async function clickLauncherAndAssertPath(page: Page, key: string, expectedPath: string): Promise<void> {
  await page.goto("/chat");
  await page.waitForURL(/\/chat\//);

  await page.getByTestId(`plugin-launcher-${key}`).click();

  await page.waitForURL(new RegExp(`${expectedPath}(?:$|\\?)`));
  expect(new URL(page.url()).pathname).toBe(expectedPath);
}

test.describe("plugin launcher — navigation path", () => {
  test("Todos button navigates to /todos", async ({ page }) => {
    await clickLauncherAndAssertPath(page, "todos", "/todos");
  });

  test("Scheduler button navigates to /scheduler", async ({ page }) => {
    await clickLauncherAndAssertPath(page, "scheduler", "/scheduler");
  });

  test("Wiki button navigates to /wiki", async ({ page }) => {
    await clickLauncherAndAssertPath(page, "wiki", "/wiki");
  });

  test("Skills button navigates to /skills", async ({ page }) => {
    await clickLauncherAndAssertPath(page, "skills", "/skills");
  });

  test("Roles button navigates to /roles", async ({ page }) => {
    await clickLauncherAndAssertPath(page, "roles", "/roles");
  });

  test("Files button navigates to /files with no path param", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-files").click();

    await page.waitForURL(/\/files(?:$|\?)/);
    const url = new URL(page.url());
    expect(url.pathname).toBe("/files");
    expect(url.searchParams.get("path")).toBeNull();
  });
});
