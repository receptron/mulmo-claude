// URL-driven navigation for the wiki plugin.
//
// Covers the routing contract established by plans/feat-wiki-url-sync.md:
//
// - /wiki              → index
// - /wiki?page=<slug>  → page view
// - /wiki?view=log     → activity log
// - /wiki?view=lint_report → lint report
//
// Also regressions:
//
// - TDZ in the immediate route watcher (navError declared after callApi
//   meant direct /wiki loads silently did nothing and rendered
//   "Wiki is empty").
// - Mount-vs-watcher race on ?view= / ?page= direct loads
//   (useFreshPluginData's GET returned the index payload, clobbering
//   the POST-driven log / page state when it resolved last).

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const INDEX_PAYLOAD = {
  action: "index",
  title: "Wiki Index",
  content: "# Wiki Index\n\nRoot page.",
  pageEntries: [
    { title: "Onboarding", slug: "onboarding", description: "Getting started" },
    { title: "Architecture", slug: "architecture", description: "How things fit" },
  ],
};

const PAGE_ONBOARDING = {
  action: "page",
  title: "Onboarding",
  pageName: "onboarding",
  content: "# Onboarding\n\nWelcome to the project.",
};

const LOG_PAYLOAD = {
  action: "log",
  title: "Activity Log",
  content: "## 2026-04-22\n- Did stuff",
};

async function mockWikiApi(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/wiki",
    async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        const slug = new URL(req.url()).searchParams.get("slug");
        if (slug === "onboarding") return route.fulfill({ json: { data: PAGE_ONBOARDING } });
        return route.fulfill({ json: { data: INDEX_PAYLOAD } });
      }
      if (req.method() === "POST") {
        const body = (req.postDataJSON() ?? {}) as { action?: string; pageName?: string };
        if (body.action === "page" && body.pageName === "onboarding") {
          return route.fulfill({ json: { data: PAGE_ONBOARDING } });
        }
        if (body.action === "log") return route.fulfill({ json: { data: LOG_PAYLOAD } });
        return route.fulfill({ json: { data: INDEX_PAYLOAD } });
      }
      return route.fallback();
    },
  );
}

test.describe("wiki navigation — URL sync", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await mockWikiApi(page);
  });

  test("direct /wiki load renders the index page list", async ({ page }) => {
    // Regression guard: a TDZ inside the immediate URL watcher used to
    // swallow the POST silently and leave the view stuck on the empty
    // state.
    await page.goto("/wiki");
    await expect(page.getByTestId("wiki-page-entry-onboarding")).toBeVisible();
    await expect(page.getByTestId("wiki-page-entry-architecture")).toBeVisible();
    // Empty-state copy must NOT show when the index has entries.
    await expect(page.getByText("Wiki is empty", { exact: false })).toHaveCount(0);
  });

  test("clicking a page card updates the URL and renders the page", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.getByTestId("wiki-page-entry-onboarding")).toBeVisible();

    await page.getByTestId("wiki-page-entry-onboarding").click();

    await page.waitForURL(/\/wiki\?page=onboarding/);
    // h1 comes from the rendered page markdown; h2 is the view header.
    await expect(page.getByRole("heading", { level: 1, name: "Onboarding" })).toBeVisible();
    await expect(page.getByText("Welcome to the project.")).toBeVisible();
  });

  test("clicking the Log tab switches to ?view=log", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.getByText("Onboarding")).toBeVisible();

    await page.getByRole("button", { name: /Log/ }).click();

    await page.waitForURL(/\/wiki\?view=log/);
    await expect(page.getByText("Did stuff")).toBeVisible();
  });

  test("direct /wiki?view=log load renders log content, not index", async ({ page }) => {
    // Regression guard: useFreshPluginData's mount GET returns the
    // index payload; if it resolves after the POST-driven log fetch
    // on a direct load, the log content was clobbered.
    await page.goto("/wiki?view=log");

    await expect(page.getByText("Did stuff")).toBeVisible();
    // Page-card rows from the index must not appear here.
    await expect(page.getByTestId("wiki-page-entry-onboarding")).toHaveCount(0);
    await expect(page.getByTestId("wiki-page-entry-architecture")).toHaveCount(0);
  });

  test("direct /wiki?page=onboarding load renders the page", async ({ page }) => {
    await page.goto("/wiki?page=onboarding");

    await expect(page.getByRole("heading", { level: 1, name: "Onboarding" })).toBeVisible();
    await expect(page.getByText("Welcome to the project.")).toBeVisible();
  });
});

test.describe("wiki navigation — from manageWiki tool result", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page, {
      sessions: [
        {
          id: "wiki-session",
          title: "Wiki Session",
          roleId: "general",
          startedAt: "2026-04-12T10:00:00Z",
          updatedAt: "2026-04-12T10:05:00Z",
        },
      ],
    });
    await mockWikiApi(page);

    // Session transcript with a manageWiki INDEX tool result.
    await page.route(
      (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
      (route) =>
        route.fulfill({
          json: [
            { type: "session_meta", roleId: "general", sessionId: "wiki-session" },
            { type: "text", source: "user", message: "Show the wiki" },
            {
              type: "tool_result",
              source: "tool",
              result: {
                uuid: "wiki-index-result",
                toolName: "manageWiki",
                title: INDEX_PAYLOAD.title,
                message: "Index loaded",
                data: INDEX_PAYLOAD,
              },
            },
          ],
        }),
    );
  });

  test("clicking a page card in a tool-result index navigates to /wiki", async ({ page }) => {
    await page.goto("/chat/wiki-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Select the wiki index tool result in the right sidebar.
    await page.getByText(`Wiki Index`, { exact: false }).first().click();
    await expect(page.getByTestId("wiki-page-entry-onboarding")).toBeVisible();

    await page.getByTestId("wiki-page-entry-onboarding").click();

    // From /chat, clicking a page card should land on /wiki with the
    // shareable query. Chat-specific params like ?result= must NOT
    // bleed through — the URL should be exactly /wiki?page=<slug>.
    await page.waitForURL(/\/wiki\?page=onboarding/);
    expect(new URL(page.url()).search).toBe("?page=onboarding");
    await expect(page.getByRole("heading", { level: 1, name: "Onboarding" })).toBeVisible();
  });

  test("session tab click from /wiki navigates back to /chat for that session", async ({ page }) => {
    // Regression: loadSession used to early-return whenever
    // `sessionId === currentSessionId.value`, which left the user
    // stuck on /wiki because currentSessionId is not reset when
    // navigating to a non-chat page. The guard now also checks the
    // URL so cross-page re-selection actually navigates.
    await page.goto("/chat/wiki-session");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Leave /chat for /wiki.
    await page.goto("/wiki");
    await expect(page.getByTestId("wiki-page-entry-onboarding")).toBeVisible();
    expect(page.url()).toContain("/wiki");

    // Re-select the same session from the tab bar — this was a no-op.
    await page.getByTestId("session-tab-wiki-session").click();

    await page.waitForURL(/\/chat\/wiki-session/);
    expect(new URL(page.url()).pathname).toBe("/chat/wiki-session");
  });
});
