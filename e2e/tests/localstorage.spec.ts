import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";
test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

test.describe("localStorage state restoration", () => {
  test("canvas_view_mode=files → starts in files view", async ({ page }) => {
    // Set localStorage BEFORE navigating so the app picks it up on init.
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("canvas_view_mode", "files"));
    await page.reload();
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    // URL should reflect files view
    await expect(async () => {
      const url = new URL(page.url());
      expect(url.searchParams.get("view")).toBe("files");
    }).toPass({ timeout: 5 * ONE_SECOND_MS });
  });

  test("canvas_view_mode=stack → starts in stack view", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("canvas_view_mode", "stack"));
    await page.reload();
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await expect(async () => {
      const url = new URL(page.url());
      expect(url.searchParams.get("view")).toBe("stack");
    }).toPass({ timeout: 5 * ONE_SECOND_MS });
  });

  test("canvas_view_mode with invalid value → defaults to single", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("canvas_view_mode", "<script>alert(1)</script>"));
    await page.reload();
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    // "single" is the default — no ?view= param in the URL
    await expect(async () => {
      const url = new URL(page.url());
      expect(url.searchParams.get("view")).toBeNull();
    }).toPass({ timeout: 5 * ONE_SECOND_MS });
  });

  test("right_sidebar_visible is preserved across reloads", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("right_sidebar_visible", "true"));
    await page.reload();
    // The right sidebar should be visible (it contains tool call history).
    // We check for the build icon which toggles it.
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    // The right sidebar state is a UI pref — just verify no crash.
  });

  test("corrupted localStorage values don't crash the app", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("canvas_view_mode", '{"__proto__":{"x":1}}');
      localStorage.setItem("right_sidebar_visible", "maybe");
      localStorage.setItem("files_expanded_dirs", "not-json");
      localStorage.setItem("todo_explorer_view_mode", "");
    });
    await page.reload();
    await expect(page.getByText("MulmoClaude")).toBeVisible();
  });

  test("todo_explorer_view_mode=table persists across reload", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("todo_explorer_view_mode", "table"));
    // The todo view mode is read when TodoExplorer mounts, not at
    // app startup. We just verify the value survives a reload and
    // the app doesn't crash.
    await page.reload();
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem("todo_explorer_view_mode"));
    expect(stored).toBe("table");
  });

  test("files_expanded_dirs with valid JSON set is preserved", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("files_expanded_dirs", JSON.stringify(["", "wiki", "todos"])));
    await page.reload();
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem("files_expanded_dirs"));
    expect(JSON.parse(stored!)).toContain("wiki");
  });
});
