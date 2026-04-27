// Wiki page image references must resolve under the `data/wiki/...`
// layout. Locks the bug fix from PR #848 (the prior `wiki/` →
// `data/wiki/` workspace migration had left `basePath` behind in
// View.vue, breaking every relative image ref in wiki pages).
//
// Asserts the rendered <img src> shape produced by
// rewriteMarkdownImageRefs + resolveImageSrc:
//   /api/files/raw?path=<workspace-relative path>
//
// Two ways the basepath can drift:
// - page action  → must root at `data/wiki/pages` (was `wiki/pages`)
// - index/log/etc → must root at `data/wiki`       (was `wiki`)

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const PAGE_RELATIVE_UP = {
  action: "page",
  title: "imagepage",
  pageName: "imagepage",
  content: "# imagepage\n\n![chart](../sources/foo.png)\n",
  pageExists: true,
};

const PAGE_SAME_DIR = {
  action: "page",
  title: "imagepage2",
  pageName: "imagepage2",
  content: "# imagepage2\n\n![bar](images/bar.png)\n",
  pageExists: true,
};

const INDEX_WITH_IMAGE = {
  action: "index",
  title: "Wiki Index",
  content: "# Wiki Index\n\n![baz](images/baz.png)\n",
  pageEntries: [],
};

const PAGE_MAP: Record<string, unknown> = {
  imagepage: PAGE_RELATIVE_UP,
  imagepage2: PAGE_SAME_DIR,
};

async function mockWikiApi(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/wiki",
    async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        const slug = new URL(req.url()).searchParams.get("slug");
        const data = slug && PAGE_MAP[slug] ? PAGE_MAP[slug] : INDEX_WITH_IMAGE;
        return route.fulfill({ json: { data } });
      }
      if (req.method() === "POST") {
        const body = (req.postDataJSON() ?? {}) as { action?: string; pageName?: string };
        if (body.action === "page" && body.pageName && PAGE_MAP[body.pageName]) {
          return route.fulfill({ json: { data: PAGE_MAP[body.pageName] } });
        }
        return route.fulfill({ json: { data: INDEX_WITH_IMAGE } });
      }
      return route.fallback();
    },
  );
}

// Decode the `path=` query param so the assertion ignores
// percent-encoding differences (e.g. `%2F` vs `/`).
function rawPathOf(src: string | null): string {
  expect(src).not.toBeNull();
  const url = new URL(src as string, "http://localhost");
  expect(url.pathname).toBe("/api/files/raw");
  return url.searchParams.get("path") ?? "";
}

test.describe("wiki image basepath — data/wiki layout lock", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await mockWikiApi(page);
  });

  test("page action: '../sources/foo.png' resolves under data/wiki/", async ({ page }) => {
    await page.goto("/wiki/pages/imagepage");
    const img = page.locator("img[alt='chart']");
    await expect(img).toBeVisible();
    expect(rawPathOf(await img.getAttribute("src"))).toBe("data/wiki/sources/foo.png");
  });

  test("page action: 'images/bar.png' resolves under data/wiki/pages/", async ({ page }) => {
    await page.goto("/wiki/pages/imagepage2");
    const img = page.locator("img[alt='bar']");
    await expect(img).toBeVisible();
    expect(rawPathOf(await img.getAttribute("src"))).toBe("data/wiki/pages/images/bar.png");
  });

  test("index action: 'images/baz.png' resolves under data/wiki/", async ({ page }) => {
    await page.goto("/wiki");
    const img = page.locator("img[alt='baz']");
    await expect(img).toBeVisible();
    expect(rawPathOf(await img.getAttribute("src"))).toBe("data/wiki/images/baz.png");
  });
});
