import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

// Helper: open the session-history side panel and wait for sessions
// to load. The toggle is idempotent — callers that open the panel
// twice in a row (e.g. between two session selects) should call
// this helper both times; selecting a session does not auto-close
// the panel.
async function openHistoryWithSessions(page: Page) {
  const toggle = page.getByTestId("session-history-toggle-off");
  // Panel is only closed when the off-state toggle is present; no-op
  // if the panel is already open.
  if (await toggle.isVisible()) {
    await toggle.click();
  }
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

  test("browser back returns to the previous session", async ({ page }) => {
    // With /history gone, the side panel is DOM state, not a route.
    // Stack after two session selects: [..., /chat/<initial>,
    // /chat/A, /chat/B]. One back → /chat/A.
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await openHistoryWithSessions(page);
    await page.locator(`[data-testid="session-item-${SESSION_A.id}"]`).click();
    await page.waitForURL(new RegExp(SESSION_A.id));

    await page.locator(`[data-testid="session-item-${SESSION_B.id}"]`).click();
    await page.waitForURL(new RegExp(SESSION_B.id));

    await page.goBack();
    await page.waitForURL(new RegExp(SESSION_A.id));
  });

  test("browser forward works after going back", async ({ page }) => {
    // Stack after two session selects: [..., /chat/<initial>,
    // /chat/A, /chat/B]. Back lands on /chat/A; forward returns
    // to /chat/B.
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await openHistoryWithSessions(page);
    await page.locator(`[data-testid="session-item-${SESSION_A.id}"]`).click();
    await page.waitForURL(new RegExp(SESSION_A.id));

    await page.locator(`[data-testid="session-item-${SESSION_B.id}"]`).click();
    await page.waitForURL(new RegExp(SESSION_B.id));

    await page.goBack();
    await page.waitForURL(new RegExp(SESSION_A.id));

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

  test("/calendar loads the calendar page", async ({ page }) => {
    await page.goto("/calendar");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/calendar");
  });

  test("/automations loads the automations page", async ({ page }) => {
    await page.goto("/automations");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/automations");
  });

  test("/scheduler redirects to /calendar (bookmark preservation for #758)", async ({ page }) => {
    await page.goto("/scheduler");
    await page.waitForURL(/\/calendar(?:$|\?)/);
    expect(new URL(page.url()).pathname).toBe("/calendar");
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

  test("legacy /history bookmark falls through to /chat", async ({ page }) => {
    // The old /history route is gone; the catch-all redirects
    // anything unknown (including deep /history/<filter> bookmarks)
    // to /chat so existing bookmarks don't 404.
    await page.goto("/history");
    await page.waitForURL(/\/chat/);
    expect(new URL(page.url()).pathname).toMatch(/^\/chat/);
  });

  test("legacy /history/<filter> bookmark falls through to /chat", async ({ page }) => {
    await page.goto("/history/unread");
    await page.waitForURL(/\/chat/);
    expect(new URL(page.url()).pathname).toMatch(/^\/chat/);
  });
});
