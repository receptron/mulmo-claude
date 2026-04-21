// Plugin launcher buttons that sit above the canvas. All buttons
// switch the canvas view mode directly via kind:"view" — the URL
// reflects the state (?view=todos, ?view=wiki, etc.) and landing
// on that URL restores the view.
//
// First slice of issue #253.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

async function clickLauncherAndAssertView(page: Page, key: string, expectedView: string): Promise<void> {
  await page.goto("/chat");
  await page.waitForURL(/\/chat\//);

  await page.getByTestId(`plugin-launcher-${key}`).click();

  await page.waitForURL(new RegExp(`view=${expectedView}`));
  expect(new URL(page.url()).searchParams.get("view")).toBe(expectedView);
}

test.describe("plugin launcher — view path", () => {
  test("Todos button switches canvas to todos view", async ({ page }) => {
    await clickLauncherAndAssertView(page, "todos", "todos");
  });

  test("Scheduler button switches canvas to scheduler view", async ({ page }) => {
    await clickLauncherAndAssertView(page, "scheduler", "scheduler");
  });

  test("Wiki button switches canvas to wiki view", async ({ page }) => {
    await clickLauncherAndAssertView(page, "wiki", "wiki");
  });

  test("Skills button switches canvas to skills view", async ({ page }) => {
    await clickLauncherAndAssertView(page, "skills", "skills");
  });

  test("Roles button switches canvas to roles view", async ({ page }) => {
    await clickLauncherAndAssertView(page, "roles", "roles");
  });

  test("Files button switches canvas to files view", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-files").click();

    await page.waitForURL(/view=files/);
    const url = new URL(page.url());
    expect(url.searchParams.get("view")).toBe("files");
    expect(url.searchParams.get("path")).toBeNull();
  });
});
