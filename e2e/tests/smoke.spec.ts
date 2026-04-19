import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

test("app loads and shows the title", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-title")).toBeVisible();
});

test("send button and input are visible and enabled", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("user-input")).toBeVisible();
  await expect(page.getByTestId("send-btn")).toBeEnabled();
});

test("unknown route still shows the app (catch-all redirect)", async ({
  page,
}) => {
  await page.goto("/some/random/path");
  await expect(page.getByTestId("app-title")).toBeVisible();
});
