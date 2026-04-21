import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

// Helper: open history panel and wait for sessions to load.
async function openHistoryWithSessions(page: Page) {
  await page.locator('[data-testid="history-btn"]').click();
  // Wait for sessions to load (fetched async when the panel opens).
  await page.locator(`[data-testid="session-item-${SESSION_A.id}"]`).waitFor({ state: "visible", timeout: 5000 });
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

  test("browser back returns to the previous session", async ({ page }) => {
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

    // Back → session A
    await page.goBack();
    await page.waitForURL(new RegExp(SESSION_A.id));
  });

  test("browser forward works after going back", async ({ page }) => {
    // Navigate through two real (non-empty) sessions so both are in
    // browser history — the initial empty session is intentionally
    // replaced out of history by removeCurrentIfEmpty.
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await openHistoryWithSessions(page);
    await page.locator(`[data-testid="session-item-${SESSION_A.id}"]`).click();
    await page.waitForURL(new RegExp(SESSION_A.id));

    await openHistoryWithSessions(page);
    await page.locator(`[data-testid="session-item-${SESSION_B.id}"]`).click();
    await page.waitForURL(new RegExp(SESSION_B.id));

    // Back → session A
    await page.goBack();
    await page.waitForURL(new RegExp(SESSION_A.id));

    // Forward → session B
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
    }).toPass({ timeout: 10000 });
    await expect(page.getByText("MulmoClaude")).toBeVisible();
  });

  test("page reload preserves the session URL", async ({ page }) => {
    await page.goto(`/chat/${SESSION_A.id}`);
    await page.waitForURL(new RegExp(SESSION_A.id));
    await page.reload();
    await page.waitForURL(new RegExp(SESSION_A.id));
  });
});

test.describe("view mode in URL", () => {
  test("?view=files switches to files view", async ({ page }) => {
    await page.goto("/chat?view=files");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    // The URL should still have ?view=files
    expect(new URL(page.url()).searchParams.get("view")).toBe("files");
  });

  test("?view=stack switches to stack view", async ({ page }) => {
    await page.goto("/chat?view=stack");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("view")).toBe("stack");
  });

  test("?view=todos switches to todos view", async ({ page }) => {
    await page.goto("/chat?view=todos");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("view")).toBe("todos");
  });

  test("?view=scheduler switches to scheduler view", async ({ page }) => {
    await page.goto("/chat?view=scheduler");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("view")).toBe("scheduler");
  });

  test("no ?view= defaults to single (no param in URL)", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);
    const url = new URL(page.url());
    // "single" is the default — no ?view= in URL
    expect(url.searchParams.get("view")).toBeNull();
  });
});
