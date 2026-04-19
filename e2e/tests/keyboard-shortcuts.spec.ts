// E2E for the Cmd/Ctrl + 1–8 canvas view-mode shortcut wired via
// useEventListeners (window keydown). Cmd on macOS, Ctrl elsewhere —
// Playwright's `page.keyboard.press("Meta+2")` targets Meta which
// Vue's handleViewModeShortcut treats the same as Ctrl.
//
// View-mode URL sync is owned by useCanvasViewMode: "single" (the
// default) omits ?view=, other modes add it.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

async function pressViewShortcut(page: Page, key: string) {
  await page.keyboard.press(`Meta+${key}`);
}

test.describe("view-mode keyboard shortcuts (useEventListeners)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("Cmd/Ctrl+2 switches to stack view (?view=stack)", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressViewShortcut(page, "2");
    await expect(page).toHaveURL(/[?&]view=stack/);
  });

  test("Cmd/Ctrl+3 switches to files view (?view=files)", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressViewShortcut(page, "3");
    await expect(page).toHaveURL(/[?&]view=files/);
  });

  test("Cmd/Ctrl+4 switches to todos view (?view=todos)", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressViewShortcut(page, "4");
    await expect(page).toHaveURL(/[?&]view=todos/);
  });

  test("Cmd/Ctrl+5 switches to scheduler view (?view=scheduler)", async ({
    page,
  }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressViewShortcut(page, "5");
    await expect(page).toHaveURL(/[?&]view=scheduler/);
  });

  test("Cmd/Ctrl+6 switches to wiki view (?view=wiki)", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressViewShortcut(page, "6");
    await expect(page).toHaveURL(/[?&]view=wiki/);
  });

  test("Cmd/Ctrl+7 switches to skills view (?view=skills)", async ({
    page,
  }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressViewShortcut(page, "7");
    await expect(page).toHaveURL(/[?&]view=skills/);
  });

  test("Cmd/Ctrl+8 switches to roles view (?view=roles)", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressViewShortcut(page, "8");
    await expect(page).toHaveURL(/[?&]view=roles/);
  });

  test("Cmd/Ctrl+1 returns to single view (?view= removed)", async ({
    page,
  }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // First go to stack, then back to single.
    await pressViewShortcut(page, "2");
    await expect(page).toHaveURL(/[?&]view=stack/);

    await pressViewShortcut(page, "1");
    await expect(page).not.toHaveURL(/[?&]view=/);
  });
});
