// E2E for the canvas-side `page-edit` action (Stage 3a, #963).
//
// When the LLM uses Claude's built-in Write/Edit tool on a wiki
// page, the server's snapshot endpoint publishes a synthetic
// `manageWiki` toolResult with `action: "page-edit"` into the
// session JSONL. The canvas (StackView) renders it via the
// existing wiki plugin, with the body sourced from the snapshot
// file by stamp — falling back to the live page when the
// snapshot has been gc'd, or to a "page deleted" placeholder
// when neither survives.
//
// We don't drive a real LLM here. Instead we seed the session
// JSONL with a page-edit tool_result entry and mock the wiki
// history / live-page routes to return the desired states.

import { test, expect } from "@playwright/test";
import type { Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const SESSION_ID = "session-page-edit-1";
const SLUG = "design-shops";
const STAMP = "2026-04-30T12-00-00-000Z-abc12345";
const PAGE_PATH = `data/wiki/pages/${SLUG}.md`;

const SNAPSHOT_BODY_MARKER = "Snapshot body marker — render me!";
const LIVE_BODY_MARKER = "Live page body marker — fallback render!";

function buildSessionEntries() {
  return [
    { type: "session_meta", roleId: "general", sessionId: SESSION_ID },
    { type: "text", source: "user", message: "Update the design-shops page" },
    {
      type: "tool_result",
      source: "tool",
      result: {
        uuid: "page-edit-result-1",
        toolName: "manageWiki",
        title: SLUG,
        data: {
          action: "page-edit",
          title: SLUG,
          slug: SLUG,
          stamp: STAMP,
          pagePath: PAGE_PATH,
        },
      },
    },
  ];
}

async function mockSessionTranscript(page: Parameters<typeof mockAllApis>[0]): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route: Route) => {
      const method = route.request().method();
      if (method === "POST") return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: buildSessionEntries() });
    },
  );
}

test.describe("page-edit (canvas inline preview)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page, {
      sessions: [
        {
          id: SESSION_ID,
          title: "Design shops edit",
          roleId: "general",
          startedAt: "2026-04-30T12:00:00Z",
          updatedAt: "2026-04-30T12:00:00Z",
          preview: "Update the design-shops page",
        },
      ],
    });
    await mockSessionTranscript(page);
  });

  test("renders the snapshot body when the stamp is found", async ({ page }) => {
    await page.route(
      (url) => url.pathname === `/api/wiki/pages/${SLUG}/history/${STAMP}`,
      (route: Route) =>
        route.fulfill({
          json: {
            slug: SLUG,
            snapshot: {
              stamp: STAMP,
              ts: "2026-04-30T12:00:00.000Z",
              editor: "llm",
              bytes: 64,
              meta: { title: SLUG, created: "2026-04-30", updated: "2026-04-30T12:00:00.000Z", editor: "llm" },
              body: `# Design shops\n\n${SNAPSHOT_BODY_MARKER}\n`,
            },
          },
        }),
    );

    await page.goto(`/chat/${SESSION_ID}`);
    // The wiki plugin's <WikiView> drops a metadata bar above the
    // body when the snapshot frontmatter has any of the four meta
    // keys — that's our "render reached the page-edit branch"
    // signal.
    await expect(page.getByTestId("wiki-page-metadata-bar")).toBeVisible();
    await expect(page.locator(".wiki-content")).toContainText(SNAPSHOT_BODY_MARKER);
    // Banner stays hidden when the snapshot was found.
    await expect(page.getByTestId("wiki-page-edit-banner")).toHaveCount(0);
    await expect(page.getByTestId("wiki-page-edit-deleted")).toHaveCount(0);
  });

  test("falls back to the live page when the snapshot is gc'd", async ({ page }) => {
    await page.route(
      (url) => url.pathname === `/api/wiki/pages/${SLUG}/history/${STAMP}`,
      (route: Route) => route.fulfill({ status: 404, json: { error: "not found" } }),
    );
    // GET /api/wiki?slug=... — the live-page fallback branch.
    await page.route(
      (url) => url.pathname === "/api/wiki",
      (route: Route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return route.fulfill({
          json: {
            data: {
              action: "page",
              title: SLUG,
              content: `---\ntitle: ${SLUG}\n---\n\n# Design shops\n\n${LIVE_BODY_MARKER}\n`,
              pageExists: true,
            },
          },
        });
      },
    );

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("wiki-page-edit-banner")).toBeVisible();
    await expect(page.locator(".wiki-content")).toContainText(LIVE_BODY_MARKER);
    await expect(page.getByTestId("wiki-page-edit-deleted")).toHaveCount(0);
  });

  test("shows the deleted placeholder when both snapshot and live page are gone", async ({ page }) => {
    await page.route(
      (url) => url.pathname === `/api/wiki/pages/${SLUG}/history/${STAMP}`,
      (route: Route) => route.fulfill({ status: 404, json: { error: "not found" } }),
    );
    await page.route(
      (url) => url.pathname === "/api/wiki",
      (route: Route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return route.fulfill({
          json: {
            data: { action: "page", title: SLUG, content: "", pageExists: false },
          },
        });
      },
    );

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("wiki-page-edit-deleted")).toBeVisible();
    await expect(page.getByTestId("wiki-page-edit-banner")).toHaveCount(0);
  });
});
