// E2E for the dedicated /news page (#761).
//
// Covers the happy-path of the news viewer:
// - Direct-link to /news fetches items + read-state
// - List renders item cards with unread bullets
// - Clicking an item moves it to the detail pane and marks it read
// - The Unread filter narrows the list
// - "Mark all read" empties the Unread list
//
// All `/api/news/*` endpoints are mocked; the tests don't need a
// running server-side aggregator.

import { test, expect, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

interface MockItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  categories: string[];
  sourceSlug: string;
}

const ITEM_A: MockItem = {
  id: "alpha-1",
  title: "Alpha headline",
  url: "https://example.com/alpha",
  publishedAt: "2026-04-15T01:00:00.000Z",
  categories: ["tech-news"],
  sourceSlug: "alpha-source",
};

const ITEM_B: MockItem = {
  id: "beta-1",
  title: "Beta headline",
  url: "https://example.com/beta",
  publishedAt: "2026-04-15T02:00:00.000Z",
  categories: ["startup"],
  sourceSlug: "beta-source",
};

interface MockState {
  items: MockItem[];
  readIds: Set<string>;
  bodies: Record<string, string | null>;
}

async function installNewsMocks(page: import("@playwright/test").Page, items: MockItem[]): Promise<MockState> {
  await mockAllApis(page);
  const state: MockState = {
    items,
    readIds: new Set<string>(),
    bodies: { [ITEM_A.id]: "Body of Alpha", [ITEM_B.id]: null },
  };

  await page.route(
    (url) => url.pathname === "/api/news/items",
    (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({ json: { items: state.items } });
    },
  );

  await page.route(
    (url) => url.pathname.startsWith("/api/news/items/") && url.pathname.endsWith("/body"),
    (route: Route) => {
      const segments = new URL(route.request().url()).pathname.split("/");
      const itemId = decodeURIComponent(segments[segments.length - 2]);
      return route.fulfill({ json: { body: state.bodies[itemId] ?? null } });
    },
  );

  await page.route(
    (url) => url.pathname === "/api/news/read-state",
    (route: Route) => {
      const method = route.request().method();
      if (method === "GET") {
        return route.fulfill({ json: { readIds: Array.from(state.readIds) } });
      }
      if (method === "PUT") {
        const body = route.request().postDataJSON() as { readIds: string[] };
        state.readIds = new Set(body.readIds);
        return route.fulfill({ json: { readIds: Array.from(state.readIds) } });
      }
      return route.fallback();
    },
  );

  return state;
}

test.describe("/news page", () => {
  test("renders items, marks one read on click, and Unread filter narrows the list", async ({ page }) => {
    await installNewsMocks(page, [ITEM_A, ITEM_B]);
    await page.goto("/news");

    // Both items render in the list.
    await expect(page.getByTestId(`news-item-${ITEM_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`news-item-${ITEM_B.id}`)).toBeVisible();

    // Click ITEM_A — detail pane shows the title.
    await page.getByTestId(`news-item-${ITEM_A.id}`).click();
    await expect(page.getByTestId("news-detail").getByText(ITEM_A.title)).toBeVisible();

    // Unread filter should still show ITEM_B (not yet read) but
    // eventually drop ITEM_A once the auto-mark-read fires.
    await page.getByTestId("news-filter-unread").click();
    await expect(page.getByTestId(`news-item-${ITEM_B.id}`)).toBeVisible();
    await expect(page.getByTestId(`news-item-${ITEM_A.id}`)).toBeHidden();
  });

  test("Mark all read empties the Unread filter", async ({ page }) => {
    await installNewsMocks(page, [ITEM_A, ITEM_B]);
    await page.goto("/news");

    await page.getByTestId("news-filter-unread").click();
    await expect(page.getByTestId(`news-item-${ITEM_A.id}`)).toBeVisible();

    await page.getByTestId("news-mark-all-read").click();

    // After the bulk mark-all PUT, the unread-filtered list empties.
    await expect(page.getByTestId(`news-item-${ITEM_A.id}`)).toBeHidden();
    await expect(page.getByTestId(`news-item-${ITEM_B.id}`)).toBeHidden();
  });

  test("source filter chip narrows by sourceSlug", async ({ page }) => {
    await installNewsMocks(page, [ITEM_A, ITEM_B]);
    await page.goto("/news");

    await page.getByTestId("news-filter-all").click();
    await page.getByTestId(`news-source-${ITEM_A.sourceSlug}`).click();

    await expect(page.getByTestId(`news-item-${ITEM_A.id}`)).toBeVisible();
    await expect(page.getByTestId(`news-item-${ITEM_B.id}`)).toBeHidden();
  });

  test("?source query param pre-selects the source filter", async ({ page }) => {
    await installNewsMocks(page, [ITEM_A, ITEM_B]);
    await page.goto(`/news?source=${ITEM_B.sourceSlug}`);
    await page.getByTestId("news-filter-all").click();

    await expect(page.getByTestId(`news-item-${ITEM_B.id}`)).toBeVisible();
    await expect(page.getByTestId(`news-item-${ITEM_A.id}`)).toBeHidden();
  });

  test("renders body without raw `---` fence when an item carries frontmatter (#895 PR D)", async ({ page }) => {
    // Regression guard for the NewsView frontmatter strip added in
    // PR D. RSS feeds normally don't carry markdown frontmatter, but
    // a feed mirroring a markdown blog could — and `marked()` would
    // otherwise render the fence as `<hr>` plus the YAML keys as
    // plain body text. The strip via `parseFrontmatter` is defensive
    // and a no-op for header-less inputs; this test pins it.
    const state = await installNewsMocks(page, [ITEM_A]);
    state.bodies[ITEM_A.id] = [
      "---",
      "title: Alpha headline",
      "tags: [demo]",
      "---",
      "",
      "# Real Body Heading",
      "",
      "This is the article body itself.",
      "",
    ].join("\n");

    await page.goto("/news");
    await page.getByTestId(`news-item-${ITEM_A.id}`).click();

    // The body's H1 text comes from `# Real Body Heading` (post-strip).
    await expect(page.getByText("Real Body Heading")).toBeVisible();
    await expect(page.getByText("This is the article body itself.")).toBeVisible();

    // Pre-strip the fence would have rendered as `<hr>` and
    // `title: Alpha headline` would appear as visible text. After
    // strip, neither remains in the rendered detail pane.
    const detailPane = page.getByTestId("news-detail");
    const detailText = await detailPane.innerText();
    expect(detailText).not.toContain("title: Alpha headline");
    expect(detailText).not.toMatch(/^---$/m);
  });
});
