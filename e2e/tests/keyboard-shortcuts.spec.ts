// E2E for the Cmd/Ctrl + 1/2/3/4/5 canvas view-mode shortcut wired via
// useEventListeners (window keydown). Cmd on macOS, Ctrl elsewhere —
// Playwright's `page.keyboard.press("Meta+2")` targets Meta which
// Vue's handleViewModeShortcut treats the same as Ctrl.
//
// View-mode URL sync is owned by useCanvasViewMode: "single" (the
// default) omits ?view=, "stack" / "files" / "todos" / "scheduler" add it.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// Determine the modifier key per-platform. Playwright exposes the
// target platform via the browser context user agent — easier to
// just try Meta first and fall back to Control if the URL doesn't
// change. Keep the shortcut helper explicit so tests stay readable.
async function pressViewShortcut(page: Page, key: "1" | "2" | "3" | "4" | "5") {
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
