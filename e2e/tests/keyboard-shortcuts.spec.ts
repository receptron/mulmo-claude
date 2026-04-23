// E2E for the Cmd/Ctrl + 1–7 keyboard shortcuts wired via
// useEventListeners (window keydown). Cmd on macOS, Ctrl elsewhere —
// Playwright's `page.keyboard.press("Meta+2")` targets Meta which the
// handler treats the same as Ctrl.
//
// After the layout/page split:
//  - Cmd+1 toggles layout (single ↔ stack) when on /chat; on other
//    pages it navigates back to /chat without toggling.
//  - Cmd+2–7 navigate directly to /files, /todos, /scheduler, /wiki,
//    /skills, /roles.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

async function pressShortcut(page: Page, key: string) {
  await page.keyboard.press(`Meta+${key}`);
}

test.describe("keyboard shortcuts (useEventListeners)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("Cmd/Ctrl+2 navigates to /files", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressShortcut(page, "2");
    await expect(page).toHaveURL(/\/files(?:$|\?)/);
  });

  test("Cmd/Ctrl+3 navigates to /todos", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressShortcut(page, "3");
    await expect(page).toHaveURL(/\/todos(?:$|\?)/);
  });

  test("Cmd/Ctrl+4 navigates to /scheduler", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressShortcut(page, "4");
    await expect(page).toHaveURL(/\/scheduler(?:$|\?)/);
  });

  test("Cmd/Ctrl+5 navigates to /wiki", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressShortcut(page, "5");
    await expect(page).toHaveURL(/\/wiki(?:$|\?)/);
  });

  test("Cmd/Ctrl+6 navigates to /skills", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressShortcut(page, "6");
    await expect(page).toHaveURL(/\/skills(?:$|\?)/);
  });

  test("Cmd/Ctrl+7 navigates to /roles", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await pressShortcut(page, "7");
    await expect(page).toHaveURL(/\/roles(?:$|\?)/);
  });

  test("Cmd/Ctrl+1 on /chat toggles layout (persists in localStorage)", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Starts in "single".
    await expect(async () => {
      const stored = await page.evaluate(() => localStorage.getItem("canvas_layout_mode"));
      expect(stored === null || stored === "single").toBeTruthy();
    }).toPass();

    await pressShortcut(page, "1");
    await expect(async () => {
      const stored = await page.evaluate(() => localStorage.getItem("canvas_layout_mode"));
      expect(stored).toBe("stack");
    }).toPass();

    await pressShortcut(page, "1");
    await expect(async () => {
      const stored = await page.evaluate(() => localStorage.getItem("canvas_layout_mode"));
      expect(stored).toBe("single");
    }).toPass();
  });

  test("Cmd/Ctrl+1 from a non-chat page navigates to /chat without toggling layout", async ({ page }) => {
    // Preset layout to single so we can detect any unexpected toggle.
    await page.goto("/chat");
    await page.evaluate(() => localStorage.setItem("canvas_layout_mode", "single"));

    await page.goto("/files");
    await expect(page).toHaveURL(/\/files/);

    await pressShortcut(page, "1");
    await expect(page).toHaveURL(/\/chat(?:\/|$|\?)/);

    const stored = await page.evaluate(() => localStorage.getItem("canvas_layout_mode"));
    expect(stored).toBe("single");
  });

  test("Cmd/Ctrl+1 keeps the user's role selector pick when resuming a session (#701)", async ({ page }) => {
    // The role selector is user-owned: only the dropdown mutates it.
    // Resuming a session from another page must not yank the selector
    // back to the session's own roleId.
    //
    // Fixture sessions are created with roleId "general". Change the
    // selector to "artist" on /files, then Cmd+1 back to /chat and
    // confirm the selector still shows "Artist" even though the
    // resumed session is tagged "general".
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.goto("/files");
    await expect(page).toHaveURL(/\/files/);

    await page.getByTestId("role-selector-btn").click();
    await page.getByTestId("role-option-artist").click();
    await expect(page.getByTestId("role-selector-btn")).toContainText("Artist");

    await pressShortcut(page, "1");
    await expect(page).toHaveURL(/\/chat\//);
    await expect(page.getByTestId("role-selector-btn")).toContainText("Artist");
  });
});
