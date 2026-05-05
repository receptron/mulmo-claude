// E2E for the Debug-role gate. The role appears in the dropdown
// only when /api/system/config reports `devMode: true`. This proves
// the runtime endpoint flows through `useSystemConfig` →
// `applyDevModeFilter` → the visible RoleSelector list.

import { test, expect, type Page, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

async function mockSystemConfig(page: Page, devMode: boolean) {
  // Registered AFTER mockAllApis so Playwright's
  // last-registered-first ordering puts this override ahead of the
  // default `{ devMode: false }` mock baked into mockAllApis.
  await page.route(urlEndsWith("/api/system/config"), (route: Route) => route.fulfill({ json: { devMode } }));
}

test.describe("Debug role gate", () => {
  test("DEV_MODE off → Debug role absent from the dropdown", async ({ page }) => {
    await mockAllApis(page);
    // mockAllApis already mocks `/api/system/config` to devMode: false,
    // so no extra override needed for this case.
    await page.goto("/chat");

    // Open the dropdown so role options render.
    await page.getByTestId("role-selector-btn").click();

    // General is always present — sanity check the dropdown rendered.
    await expect(page.getByTestId("role-option-general")).toBeVisible();
    // Debug must not be in the option list.
    await expect(page.getByTestId("role-option-debug")).toHaveCount(0);
  });

  test("DEV_MODE on → Debug role visible in the dropdown", async ({ page }) => {
    await mockAllApis(page);
    await mockSystemConfig(page, true);
    await page.goto("/chat");

    await page.getByTestId("role-selector-btn").click();

    await expect(page.getByTestId("role-option-debug")).toBeVisible();
    await expect(page.getByTestId("role-option-debug")).toContainText("Debug");
  });
});
