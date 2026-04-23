// E2E for the dedicated /sources page (#673).
//
// Covers:
// - Nav entry appears in the plugin launcher
// - Clicking the launcher button navigates to /sources
// - Direct-link to /sources fetches the source list via API
// - Register form submits POST /api/sources and triggers a rebuild
// - Delete button sends DELETE /api/sources/:slug and removes the row
//
// The existing manageSource plugin (chat context) is covered elsewhere
// by plugin-level specs — this file focuses on the page-route entry
// point and the shared SourcesManager component's page-mode behavior.

import { test, expect, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

interface MockSource {
  slug: string;
  title: string;
  url: string;
  fetcherKind: "rss" | "github-releases" | "github-issues" | "arxiv";
  fetcherParams: Record<string, string>;
  schedule: "daily" | "weekly" | "manual";
  categories: string[];
  maxItemsPerFetch: number;
  addedAt: string;
  notes?: string;
}

function makeSource(slug: string, title: string, url: string): MockSource {
  return {
    slug,
    title,
    url,
    fetcherKind: "rss",
    fetcherParams: { rss_url: url },
    schedule: "daily",
    categories: [],
    maxItemsPerFetch: 20,
    addedAt: "2026-04-23T00:00:00Z",
  };
}

const SOURCE_A = makeSource("hacker-news", "Hacker News", "https://news.ycombinator.com/rss");
const SOURCE_B = makeSource("arxiv-cs-cl", "arXiv cs.CL", "https://export.arxiv.org/api/query?search_query=cat:cs.CL");

// Register the fixture handlers AFTER `mockAllApis` so they take
// priority over the catch-all. /api/sources uses a mutable state
// holder so tests can observe delete/add and the component's
// post-mutation refreshList().
interface SourcesState {
  sources: MockSource[];
  rebuildCalls: number;
  createCalls: Array<Record<string, unknown>>;
}

async function installSourcesMocks(page: import("@playwright/test").Page, initial: MockSource[]): Promise<SourcesState> {
  const state: SourcesState = {
    sources: [...initial],
    rebuildCalls: 0,
    createCalls: [],
  };

  // Both handlers use exact pathname equality (`url.pathname ===
  // "/api/sources"` vs `=== "/api/sources/rebuild"`) so they don't
  // shadow each other regardless of registration order — the DELETE
  // handler below uses a prefix match and excludes `/rebuild`
  // explicitly. Tracks the number of create-POSTs and rebuild-POSTs
  // so tests can assert the commitAdd/installPreset flow.
  await page.route(
    (url) => url.pathname === "/api/sources",
    (route: Route) => {
      const method = route.request().method();
      if (method === "GET") {
        return route.fulfill({ json: { sources: state.sources } });
      }
      if (method === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        state.createCalls.push(body);
        const newSource: MockSource = {
          ...makeSource(
            (body.slug as string) || `slug-${state.sources.length}`,
            (body.title as string) || "new source",
            (body.url as string) || "https://example.com/rss",
          ),
          fetcherKind: (body.fetcherKind as MockSource["fetcherKind"]) ?? "rss",
          fetcherParams: (body.fetcherParams as Record<string, string>) ?? {},
          categories: (body.categories as string[]) ?? [],
        };
        state.sources.push(newSource);
        return route.fulfill({ json: { source: newSource } });
      }
      return route.fallback();
    },
  );

  await page.route(
    (url) => url.pathname === "/api/sources/rebuild",
    (route: Route) => {
      if (route.request().method() !== "POST") return route.fallback();
      state.rebuildCalls++;
      return route.fulfill({
        json: {
          plannedCount: state.sources.length,
          itemCount: state.sources.length * 3,
          duplicateCount: 0,
          archiveErrors: [],
          isoDate: "2026-04-23",
        },
      });
    },
  );

  await page.route(
    (url) => url.pathname.startsWith("/api/sources/") && url.pathname !== "/api/sources/rebuild",
    (route: Route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      const slug = decodeURIComponent(route.request().url().split("/api/sources/").pop() ?? "");
      const before = state.sources.length;
      state.sources = state.sources.filter((source) => source.slug !== slug);
      return route.fulfill({
        json: { removed: state.sources.length < before, stateRemoved: true },
      });
    },
  );

  // Today's brief file — 404 is fine; the component treats it as
  // "no brief yet" rather than an error.
  await page.route(
    (url) => url.pathname === "/api/files/content",
    (route: Route) => route.fulfill({ status: 404, json: { error: "not found" } }),
  );

  return state;
}

test.describe("/sources page", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("plugin launcher includes a Sources button", async ({ page }) => {
    await installSourcesMocks(page, [SOURCE_A]);
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await expect(page.getByTestId("plugin-launcher-sources")).toBeVisible();
  });

  test("clicking the Sources button navigates to /sources", async ({ page }) => {
    await installSourcesMocks(page, [SOURCE_A]);
    await page.goto("/chat");
    await page.getByTestId("plugin-launcher-sources").click();
    await expect(page).toHaveURL(/\/sources$/);
  });

  test("direct-link /sources renders the registered sources", async ({ page }) => {
    await installSourcesMocks(page, [SOURCE_A, SOURCE_B]);
    await page.goto("/sources");
    await expect(page.getByTestId(`source-row-${SOURCE_A.slug}`)).toBeVisible();
    await expect(page.getByTestId(`source-row-${SOURCE_B.slug}`)).toBeVisible();
  });

  test("preset buttons don't appear until the initial /api/sources fetch resolves", async ({ page }) => {
    // Regression for the preset-race bug (PR #676 review): the empty
    // state + preset buttons rendered before GET /api/sources landed,
    // so a user could install a preset whose slugs the server already
    // had, double-registering them.
    //
    // Hold the initial GET behind a promise we release manually so we
    // can observe the gating UI in isolation.
    let releaseFirstGet: (() => void) | null = null;
    const firstGetResolved = new Promise<void>((resolve) => {
      releaseFirstGet = resolve;
    });
    let getCount = 0;

    await page.route(
      (url) => url.pathname === "/api/sources",
      async (route: Route) => {
        if (route.request().method() !== "GET") return route.fallback();
        getCount++;
        if (getCount === 1) {
          await firstGetResolved;
        }
        return route.fulfill({ json: { sources: [SOURCE_A] } });
      },
    );

    await page.goto("/sources");

    // Pre-release: loading indicator visible, presets/empty state hidden.
    await expect(page.getByTestId("sources-initial-loading")).toBeVisible();
    await expect(page.getByTestId("sources-presets")).toBeHidden();
    await expect(page.getByTestId("sources-empty")).toBeHidden();

    // Release the GET — list renders, loading indicator gone.
    releaseFirstGet!();
    await expect(page.getByTestId("sources-initial-loading")).toBeHidden();
    await expect(page.getByTestId(`source-row-${SOURCE_A.slug}`)).toBeVisible();
  });

  test("register form submits POST /api/sources and triggers rebuild", async ({ page }) => {
    const state = await installSourcesMocks(page, []);
    await page.goto("/sources");
    // Wait for the page-mode initial-loading gate to clear before
    // interacting — clicking Add before refreshList resolves would
    // hit the disabled button.
    await expect(page.getByTestId("sources-initial-loading")).toBeHidden();
    // Empty state renders preset buttons — use the explicit add form.
    await page.getByTestId("sources-add-btn").click();
    await page.getByTestId("sources-draft-primary").fill("https://example.com/feed.xml");
    await page.getByTestId("sources-draft-title").fill("Example Feed");
    await page.getByTestId("sources-draft-add").click();

    await expect(page.getByTestId("sources-action-message")).toBeVisible();
    // Wait for commitAdd → refreshList → rebuild chain to settle.
    await expect.poll(() => state.createCalls.length).toBeGreaterThanOrEqual(1);
    await expect.poll(() => state.rebuildCalls).toBeGreaterThanOrEqual(1);
    expect(state.createCalls[0]).toMatchObject({
      title: "Example Feed",
      url: "https://example.com/feed.xml",
      fetcherKind: "rss",
    });
  });

  test("delete button calls DELETE /api/sources/:slug and removes the row", async ({ page }) => {
    const state = await installSourcesMocks(page, [SOURCE_A]);
    // Auto-confirm the delete dialog.
    page.on("dialog", (dialog) => dialog.accept().catch(() => {}));

    await page.goto("/sources");
    await expect(page.getByTestId(`source-row-${SOURCE_A.slug}`)).toBeVisible();

    await page.getByTestId(`source-remove-${SOURCE_A.slug}`).click();

    await expect(page.getByTestId(`source-row-${SOURCE_A.slug}`)).toBeHidden();
    expect(state.sources.find((source) => source.slug === SOURCE_A.slug)).toBeUndefined();
  });
});
