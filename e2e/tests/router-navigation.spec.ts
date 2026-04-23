import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";
test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

// Helper: open history panel and wait for sessions to load.
async function openHistoryWithSessions(page: Page) {
  await page.locator('[data-testid="history-btn"]').click();
  // Wait for sessions to load (fetched async when the panel opens).
  await page.locator(`[data-testid="session-item-${SESSION_A.id}"]`).waitFor({ state: "visible", timeout: 5 * ONE_SECOND_MS });
}

test.describe("session navigation via URL", () => {
  test("/ redirects to /chat with a session ID in the URL", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/chat\//);
    expect(page.url()).toMatch(/\/chat\/[\w-]+/);
  });

  test("/chat creates a new session", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);
    expect(page.url()).toMatch(/\/chat\/[\w-]+/);
  });

  test("clicking a session in history changes the URL", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await openHistoryWithSessions(page);
    await page.locator(`[data-testid="session-item-${SESSION_A.id}"]`).click();

    await page.waitForURL(new RegExp(SESSION_A.id));
    expect(page.url()).toContain(SESSION_A.id);
  });

  test("browser back returns to the previous session (via /history)", async ({ page }) => {
    // /history is a real page route, so navigating between sessions
    // via the history panel leaves /history entries in browser
    // history. Stack after two selects: [..., /history, /chat/A,
    // /history, /chat/B]. One back → /history; another back → /chat/A.
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    // Navigate to session A
    await openHistoryWithSessions(page);
    await page.locator(`[data-testid="session-item-${SESSION_A.id}"]`).click();
    await page.waitForURL(new RegExp(SESSION_A.id));

    // Navigate to session B
    await openHistoryWithSessions(page);
    await page.locator(`[data-testid="session-item-${SESSION_B.id}"]`).click();
    await page.waitForURL(new RegExp(SESSION_B.id));

    // Back → /history (the panel we opened to pick B)
    await page.goBack();
    await page.waitForURL(/\/history$/);

    // Back → /chat/A
    await page.goBack();
    await page.waitForURL(new RegExp(SESSION_A.id));
  });

  test("browser forward works after going back", async ({ page }) => {
    // With /history as a real page route, the stack after two
    // session selects is [..., /history, /chat/A, /history, /chat/B].
    // Going back twice lands on /chat/A via /history; going forward
    // twice returns through /history to /chat/B.
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await openHistoryWithSessions(page);
    await page.locator(`[data-testid="session-item-${SESSION_A.id}"]`).click();
    await page.waitForURL(new RegExp(SESSION_A.id));

    await openHistoryWithSessions(page);
    await page.locator(`[data-testid="session-item-${SESSION_B.id}"]`).click();
    await page.waitForURL(new RegExp(SESSION_B.id));

    // Back twice → session A (via /history)
    await page.goBack();
    await page.waitForURL(/\/history$/);
    await page.goBack();
    await page.waitForURL(new RegExp(SESSION_A.id));

    // Forward twice → session B (via /history)
    await page.goForward();
    await page.waitForURL(/\/history$/);
    await page.goForward();
    await page.waitForURL(new RegExp(SESSION_B.id));
  });

  test("direct URL to an existing session loads it", async ({ page }) => {
    await page.goto(`/chat/${SESSION_A.id}`);
    await page.waitForURL(new RegExp(SESSION_A.id));
    await expect(page.getByText("MulmoClaude")).toBeVisible();
  });

  test("direct URL to a non-existent session falls back to new session", async ({ page }) => {
    await page.goto("/chat/nonexistent-session-xyz");
    // App tries loadSession → 404 → createNewSession → replace URL
    await expect(async () => {
      expect(page.url()).not.toContain("nonexistent-session-xyz");
    }).toPass({ timeout: 10 * ONE_SECOND_MS });
    await expect(page.getByText("MulmoClaude")).toBeVisible();
  });

  test("page reload preserves the session URL", async ({ page }) => {
    await page.goto(`/chat/${SESSION_A.id}`);
    await page.waitForURL(new RegExp(SESSION_A.id));
    await page.reload();
    await page.waitForURL(new RegExp(SESSION_A.id));
  });
});

test.describe("page routing", () => {
  test("/files loads the files page", async ({ page }) => {
    await page.goto("/files");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/files");
  });

  test("/todos loads the todos page", async ({ page }) => {
    await page.goto("/todos");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/todos");
  });

  test("/scheduler loads the scheduler page", async ({ page }) => {
    await page.goto("/scheduler");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/scheduler");
  });

  test("/wiki loads the wiki page", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/wiki");
  });

  test("/skills loads the skills page", async ({ page }) => {
    await page.goto("/skills");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/skills");
  });

  test("/roles loads the roles page", async ({ page }) => {
    await page.goto("/roles");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/roles");
  });

  test("unknown path redirects to /chat", async ({ page }) => {
    await page.goto("/does-not-exist");
    await page.waitForURL(/\/chat/);
    expect(new URL(page.url()).pathname).toMatch(/^\/chat/);
  });
});
