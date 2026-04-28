// E2E for #763 PR 3 / #944 — wiki edit-history UI.
//
// Mocks the three history endpoints exposed by PR 2 plus the wiki
// page fetch, drives the new Content / History tab strip, opens a
// snapshot's detail view, exercises the Restore confirm flow, and
// verifies the success path: tab auto-switches back to Content,
// the success toast appears, and the live page is re-fetched
// (visible because we serve a different body the second time).

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const SLUG = "history-demo";

const ORIGINAL_BODY = ["---", "title: History Demo", "---", "", "# Original heading", "", "Original body line.", ""].join("\n");

const RESTORED_BODY = ["---", "title: History Demo", "---", "", "# Restored heading", "", "Restored body line.", ""].join("\n");

const SNAPSHOT_NEWER = {
  stamp: "2026-04-28T05-19-12-597Z-newer000",
  bytes: 100,
  ts: "2026-04-28T05:19:12.597Z",
  editor: "user" as const,
  reason: "Tweak the heading",
};

const SNAPSHOT_OLDER = {
  stamp: "2026-04-28T05-18-48-677Z-older000",
  bytes: 95,
  ts: "2026-04-28T05:18:48.677Z",
  editor: "llm" as const,
};

const SNAPSHOT_OLDER_CONTENT = {
  ...SNAPSHOT_OLDER,
  meta: {
    title: "History Demo",
    _snapshot_ts: SNAPSHOT_OLDER.ts,
    _snapshot_editor: SNAPSHOT_OLDER.editor,
  },
  body: "# Older heading\n\nOlder body line.\n",
};

const SNAPSHOT_NEWER_CONTENT = {
  ...SNAPSHOT_NEWER,
  meta: {
    title: "History Demo",
    _snapshot_ts: SNAPSHOT_NEWER.ts,
    _snapshot_editor: SNAPSHOT_NEWER.editor,
    _snapshot_reason: SNAPSHOT_NEWER.reason,
  },
  body: "# Restored heading\n\nRestored body line.\n",
};

interface WikiState {
  livePageBody: string;
  restoreCalls: number;
}

function setupRoutes(page: Page, state: WikiState): Promise<void> {
  return Promise.all([
    // The page-fetch endpoint. Returns the current `livePageBody`,
    // which the restore handler swaps so the post-restore refresh
    // shows the new state.
    page.route(
      (url) => url.pathname === "/api/wiki",
      async (route) => {
        const req = route.request();
        if (req.method() !== "GET" && req.method() !== "POST") return route.fallback();
        return route.fulfill({
          json: {
            data: {
              action: "page",
              title: "History Demo",
              pageName: SLUG,
              pageExists: true,
              content: state.livePageBody,
            },
          },
        });
      },
    ),

    // List endpoint — newest first per server-side contract.
    page.route(
      (url) => url.pathname === `/api/wiki/pages/${SLUG}/history`,
      (route) =>
        route.fulfill({
          json: { slug: SLUG, snapshots: [SNAPSHOT_NEWER, SNAPSHOT_OLDER] },
        }),
    ),

    // Read endpoint — return content based on which stamp was asked.
    page.route(
      (url) => url.pathname.startsWith(`/api/wiki/pages/${SLUG}/history/`) && !url.pathname.endsWith("/restore"),
      (route) => {
        const stamp = decodeURIComponent(route.request().url().split("/history/")[1]);
        if (stamp === SNAPSHOT_NEWER.stamp) {
          return route.fulfill({ json: { slug: SLUG, snapshot: SNAPSHOT_NEWER_CONTENT } });
        }
        if (stamp === SNAPSHOT_OLDER.stamp) {
          return route.fulfill({ json: { slug: SLUG, snapshot: SNAPSHOT_OLDER_CONTENT } });
        }
        return route.fulfill({ status: 404, json: { error: "unknown stamp" } });
      },
    ),

    // Restore endpoint — flips the live body so the Content tab's
    // re-fetch surfaces the restored state.
    page.route(
      (url) => url.pathname.endsWith("/restore"),
      (route) => {
        state.restoreCalls += 1;
        state.livePageBody = RESTORED_BODY;
        return route.fulfill({
          json: { slug: SLUG, restored: { fromStamp: SNAPSHOT_NEWER.stamp } },
        });
      },
    ),
  ]).then(() => undefined);
}

test.describe("wiki history UI (#763 PR 3 / #944)", () => {
  test("list → detail → restore round trip swaps tab back to Content + shows toast", async ({ page }) => {
    const state: WikiState = { livePageBody: ORIGINAL_BODY, restoreCalls: 0 };
    await mockAllApis(page);
    await setupRoutes(page, state);

    await page.goto(`/wiki/pages/${SLUG}`);

    // Content tab is the default; the original heading should be
    // rendered by marked.
    await expect(page.getByRole("heading", { level: 1, name: "Original heading" })).toBeVisible();

    // Switch to History tab.
    await page.getByTestId("wiki-page-tab-history").click();

    // List shows two rows newest-first.
    await expect(page.getByTestId(`wiki-history-row-${SNAPSHOT_NEWER.stamp}`)).toBeVisible();
    await expect(page.getByTestId(`wiki-history-row-${SNAPSHOT_OLDER.stamp}`)).toBeVisible();

    // Click newest row → detail view.
    await page.getByTestId(`wiki-history-row-${SNAPSHOT_NEWER.stamp}`).click();
    await expect(page.getByTestId("wiki-history-detail")).toBeVisible();
    await expect(page.getByTestId("wiki-history-detail-reason")).toContainText("Tweak the heading");

    // Diff toggle shows current-vs-this by default; the snapshot's
    // body has "Restored heading" but the live page has "Original
    // heading", so the diff should surface both as add/del lines.
    await expect(page.getByTestId("wiki-history-diff-line-add").first()).toContainText("Restored heading");
    await expect(page.getByTestId("wiki-history-diff-line-del").first()).toContainText("Original heading");

    // Restore → confirm modal → confirm.
    await page.getByTestId("wiki-history-restore-button").click();
    await expect(page.getByTestId("wiki-history-restore-confirm")).toBeVisible();
    await page.getByTestId("wiki-history-restore-confirm-action").click();

    // The success toast appears and the tab snaps back to Content.
    await expect(page.getByTestId("wiki-history-restore-toast")).toBeVisible();
    // Content tab body is now showing the restored heading.
    await expect(page.getByRole("heading", { level: 1, name: "Restored heading" })).toBeVisible();

    expect(state.restoreCalls).toBe(1);
  });

  test("restore-success toast does NOT bleed onto a different page (#946 iter-1)", async ({ page }) => {
    // Codex iter-1 #946: the toast lives in View.vue with a 4 s
    // timer. If the user navigates before the timer fires the
    // toast must be cleared so it doesn't appear pinned to a
    // different page that wasn't restored.
    const state: WikiState = { livePageBody: ORIGINAL_BODY, restoreCalls: 0 };
    await mockAllApis(page);
    await setupRoutes(page, state);
    await page.route(
      (url) => url.pathname === "/api/wiki/pages/another-page/history",
      (route) => route.fulfill({ json: { slug: "another-page", snapshots: [] } }),
    );
    // /api/wiki must answer for both slugs the test visits.
    await page.unroute((url) => url.pathname === "/api/wiki");
    await page.route(
      (url) => url.pathname === "/api/wiki",
      (route) => {
        const req = route.request();
        if (req.method() !== "GET" && req.method() !== "POST") return route.fallback();
        const url = new URL(req.url());
        const slug = req.method() === "GET" ? url.searchParams.get("slug") : ((req.postDataJSON() ?? {}) as { pageName?: string }).pageName;
        if (slug === "another-page") {
          return route.fulfill({
            json: {
              data: {
                action: "page",
                title: "Another Page",
                pageName: "another-page",
                pageExists: true,
                content: "# Another\n\nNothing special.\n",
              },
            },
          });
        }
        return route.fulfill({
          json: {
            data: {
              action: "page",
              title: "History Demo",
              pageName: SLUG,
              pageExists: true,
              content: state.livePageBody,
            },
          },
        });
      },
    );

    await page.goto(`/wiki/pages/${SLUG}`);
    await page.getByTestId("wiki-page-tab-history").click();
    await page.getByTestId(`wiki-history-row-${SNAPSHOT_NEWER.stamp}`).click();
    await page.getByTestId("wiki-history-restore-button").click();
    await page.getByTestId("wiki-history-restore-confirm-action").click();

    // Toast is up.
    await expect(page.getByTestId("wiki-history-restore-toast")).toBeVisible();

    // Navigate to a different page BEFORE the 4 s timer fires.
    await page.goto("/wiki/pages/another-page");
    // Toast must be gone — the slug-change watcher cleared it.
    await expect(page.getByTestId("wiki-history-restore-toast")).toHaveCount(0);
  });

  test("empty-history slug shows the empty-state copy", async ({ page }) => {
    await mockAllApis(page);

    // Override: list endpoint returns empty.
    await page.route(
      (url) => url.pathname === "/api/wiki/pages/empty-page/history",
      (route) => route.fulfill({ json: { slug: "empty-page", snapshots: [] } }),
    );
    await page.route(
      (url) => url.pathname === "/api/wiki",
      (route) =>
        route.fulfill({
          json: {
            data: {
              action: "page",
              title: "Empty Page",
              pageName: "empty-page",
              pageExists: true,
              content: "# Empty Page\n\nNothing edited yet.\n",
            },
          },
        }),
    );

    await page.goto("/wiki/pages/empty-page");
    await page.getByTestId("wiki-page-tab-history").click();
    await expect(page.getByTestId("wiki-history-empty")).toBeVisible();
  });
});
