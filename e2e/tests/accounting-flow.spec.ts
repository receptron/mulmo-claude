// Functional flow for the accounting plugin. Mounts <AccountingApp>
// via an injected tool_result envelope (the same path the LLM's
// `openApp` action would hit in production), and drives the canvas
// against the in-memory mock from e2e/fixtures/accounting.ts. This
// exercises the empty-state → first-book → journal path without an
// LLM round-trip per click.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { mockAccountingApi, makeAccountingToolResult } from "../fixtures/accounting";

const SESSION_ID = "accounting-session";

async function setupSession(page: Page): Promise<void> {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID,
        title: "Accounting Session",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  await mockAccountingApi(page);

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: SESSION_ID },
          { type: "text", source: "user", message: "Open my books" },
          makeAccountingToolResult({ bookId: null }),
        ],
      }),
  );
}

test.describe("accounting plugin — flow", () => {
  test.beforeEach(async ({ page }) => {
    await setupSession(page);
  });

  test("openApp envelope mounts <AccountingApp>; empty workspace shows full-page first-run form", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // The accounting-app envelope auto-mounts on session load. On
    // an empty workspace the first-run NewBookForm replaces the
    // chrome (header + tabs + main) entirely — the regular
    // no-book empty-state branch does not render in this mode.
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expect(page.getByTestId("accounting-new-book-modal")).toBeVisible();
    await expect(page.getByTestId("accounting-new-book-firstrun")).toBeVisible();
    await expect(page.getByTestId("accounting-tabs")).not.toBeVisible();
    await expect(page.getByTestId("accounting-no-book")).not.toBeVisible();
  });
});
