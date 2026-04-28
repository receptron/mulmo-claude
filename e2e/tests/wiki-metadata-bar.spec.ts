// E2E for #895 PR B — wiki page metadata bar.
//
// User-visible contract: when a wiki page has frontmatter, the
// view shows a thin row above the rendered body with `Created`,
// `Updated`, `Editor`, and tags. Header-less pages keep the old
// look (no bar, just the body) — pre-existing wiki content must
// not gain an empty bar.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const PAGE_WITH_FRONTMATTER = {
  action: "page",
  title: "with-meta",
  pageName: "with-meta",
  content: [
    "---",
    "title: Onboarding Notes",
    "created: 2026-04-26",
    "updated: 2026-04-27T14:32:56.789Z",
    "editor: llm",
    "tags: [demo, onboarding]",
    "---",
    "",
    "# Body Heading",
    "",
    "This is the body.",
  ].join("\n"),
};

const PAGE_HEADER_LESS = {
  action: "page",
  title: "no-meta",
  pageName: "no-meta",
  content: "# Plain Page\n\nNo frontmatter here.",
};

const INDEX_PAYLOAD = {
  action: "index",
  title: "Wiki Index",
  content: "# Wiki Index",
  pageEntries: [
    { title: "with-meta", slug: "with-meta", description: "", tags: [] },
    { title: "no-meta", slug: "no-meta", description: "", tags: [] },
  ],
};

async function mockWikiApi(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/wiki",
    async (route) => {
      const req = route.request();
      const slug = req.method() === "GET" ? new URL(req.url()).searchParams.get("slug") : ((req.postDataJSON() ?? {}) as { pageName?: string }).pageName;
      if (slug === "with-meta") return route.fulfill({ json: { data: PAGE_WITH_FRONTMATTER } });
      if (slug === "no-meta") return route.fulfill({ json: { data: PAGE_HEADER_LESS } });
      return route.fulfill({ json: { data: INDEX_PAYLOAD } });
    },
  );
}

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
  await mockWikiApi(page);
});

test.describe("wiki metadata bar (#895 PR B)", () => {
  test("renders Created / Updated / Editor / Tags from frontmatter", async ({ page }) => {
    await page.goto("/wiki/pages/with-meta");

    // Body content visible (the H1 rendered by marked).
    await expect(page.getByRole("heading", { level: 1, name: "Body Heading" })).toBeVisible();

    // Bar visible with each field.
    const bar = page.getByTestId("wiki-page-metadata-bar");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("wiki-page-metadata-created")).toContainText("2026-04-26");
    // `updated` is formatted from UTC ISO to local-TZ
    // `YYYY-MM-DD HH:MM`. The HH:MM portion shifts by TZ, so
    // assert only the year-month prefix — both UTC and reasonable
    // user TZs (±12h) land in `2026-04-26` or `2026-04-27`.
    await expect(page.getByTestId("wiki-page-metadata-updated")).toContainText(/2026-04-2[67]/);
    await expect(page.getByTestId("wiki-page-metadata-editor")).toContainText("llm");
    // Tags rendered as chips.
    await expect(page.getByTestId("wiki-page-metadata-tag-demo")).toBeVisible();
    await expect(page.getByTestId("wiki-page-metadata-tag-onboarding")).toBeVisible();

    // Body must NOT contain the raw `---` fence text — it should
    // have been stripped before marked() rendered the body.
    const bodyText = await page.locator(".wiki-content").innerText();
    expect(bodyText).not.toMatch(/^---$/m);
    expect(bodyText).not.toContain("title: Onboarding Notes");
  });

  test("a header-less page shows no metadata bar (no regression)", async ({ page }) => {
    await page.goto("/wiki/pages/no-meta");
    await expect(page.getByRole("heading", { level: 1, name: "Plain Page" })).toBeVisible();
    // Bar must be absent — pages without frontmatter keep the old
    // look so existing wiki content doesn't gain empty UI furniture.
    await expect(page.getByTestId("wiki-page-metadata-bar")).toHaveCount(0);
  });

  test("clicking a tag chip in the metadata bar jumps to the filtered index", async ({ page }) => {
    await page.goto("/wiki/pages/with-meta");
    await expect(page.getByTestId("wiki-page-metadata-tag-demo")).toBeVisible();

    await page.getByTestId("wiki-page-metadata-tag-demo").click();

    // Lands on the index view.
    await page.waitForURL(/\/wiki$/);
  });
});
