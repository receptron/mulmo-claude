import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// Stubs a session with one manageSource tool result so the View
// renders the registry, then exercises the in-View Remove and
// Rebuild buttons (each fires its own /api/sources* request which
// we intercept).

async function setupSourceSession(page: Page) {
  await mockAllApis(page, {
    sessions: [
      {
        id: "src-session",
        title: "Sources",
        roleId: "sourceManager",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  await page.route(
    (url) =>
      url.pathname.startsWith("/api/sessions/") &&
      url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          {
            type: "session_meta",
            roleId: "sourceManager",
            sessionId: "src-session",
          },
          { type: "text", source: "user", message: "show my sources" },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "result-src-1",
              toolName: "manageSource",
              message: "Loaded source registry.",
              title: "Information sources",
              data: {
                sources: [
                  {
                    slug: "hn",
                    title: "Hacker News",
                    url: "https://news.ycombinator.com/rss",
                    fetcherKind: "rss",
                    fetcherParams: {
                      rss_url: "https://news.ycombinator.com/rss",
                    },
                    schedule: "daily",
                    categories: ["technology"],
                    maxItemsPerFetch: 30,
                    addedAt: "2026-04-14T10:00:00Z",
                  },
                  {
                    slug: "claude-code",
                    title: "Claude Code releases",
                    url: "https://github.com/anthropics/claude-code",
                    fetcherKind: "github-releases",
                    fetcherParams: { github_repo: "anthropics/claude-code" },
                    schedule: "daily",
                    categories: ["ai"],
                    maxItemsPerFetch: 30,
                    addedAt: "2026-04-14T10:00:00Z",
                  },
                ],
              },
            },
          },
        ],
      }),
  );

  // The View auto-fetches today's brief on mount. Stub as 404 so
  // the "no brief" error-state path runs cleanly without polluting
  // the test log with unhandled-route warnings.
  await page.route(
    (url) => url.pathname === "/api/files/content",
    (route) => route.fulfill({ status: 404, json: { error: "not found" } }),
  );
}

test.describe("manageSource plugin", () => {
  test.beforeEach(async ({ page }) => {
    await setupSourceSession(page);
  });

  test("renders both registered sources with type badges", async ({ page }) => {
    await page.goto("/chat/src-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await page.getByText("Information sources").first().click();

    await expect(page.locator('[data-testid="source-row-hn"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="source-row-claude-code"]'),
    ).toBeVisible();
    await expect(page.getByText("Hacker News")).toBeVisible();
    await expect(page.getByText("Claude Code releases")).toBeVisible();
  });

  test("Remove button hits DELETE and refreshes the list", async ({ page }) => {
    let deleted = false;
    await page.route(
      (url) => url.pathname === "/api/sources/hn",
      (route) => {
        if (route.request().method() !== "DELETE") return route.fallback();
        deleted = true;
        return route.fulfill({
          json: { removed: true, stateRemoved: true },
        });
      },
    );
    // After delete, the View calls GET /api/sources to refresh.
    await page.route(
      (url) =>
        url.pathname === "/api/sources" && !url.pathname.endsWith("/manage"),
      (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return route.fulfill({
          json: {
            sources: [
              {
                slug: "claude-code",
                title: "Claude Code releases",
                url: "https://github.com/anthropics/claude-code",
                fetcherKind: "github-releases",
                fetcherParams: { github_repo: "anthropics/claude-code" },
                schedule: "daily",
                categories: ["ai"],
                maxItemsPerFetch: 30,
                addedAt: "2026-04-14T10:00:00Z",
              },
            ],
          },
        });
      },
    );

    await page.goto("/chat/src-session");
    await page.getByText("Information sources").first().click();

    // Confirm dialog → accept it.
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-testid="source-remove-hn"]').click();

    await expect(page.locator('[data-testid="source-row-hn"]')).toHaveCount(0);
    await expect(
      page.locator('[data-testid="source-row-claude-code"]'),
    ).toBeVisible();
    expect(deleted).toBe(true);
  });

  test("Rebuild button hits POST /api/sources/rebuild and shows summary", async ({
    page,
  }) => {
    let rebuilt = false;
    await page.route(
      (url) => url.pathname === "/api/sources/rebuild",
      (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        rebuilt = true;
        return route.fulfill({
          json: {
            plannedCount: 2,
            itemCount: 17,
            duplicateCount: 3,
            archiveErrors: [],
            isoDate: "2026-04-14",
          },
        });
      },
    );
    await page.route(
      (url) =>
        url.pathname === "/api/sources" && !url.pathname.endsWith("/manage"),
      (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return route.fulfill({ json: { sources: [] } });
      },
    );

    await page.goto("/chat/src-session");
    await page.getByText("Information sources").first().click();

    await page.locator('[data-testid="sources-rebuild-btn"]').click();

    await expect(
      page.locator('[data-testid="sources-rebuild-summary"]'),
    ).toContainText("17");
    await expect(
      page.locator('[data-testid="sources-rebuild-summary"]'),
    ).toContainText("2");
    expect(rebuilt).toBe(true);
  });
});
