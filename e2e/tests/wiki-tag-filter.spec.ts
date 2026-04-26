// Regression guard for #830 — clicking a per-entry `#tag` chip on
// the wiki index must always SET the tag filter, even when that
// tag is already the active filter. The earlier behaviour wired
// the per-entry chip to `toggleTagFilter`, which meant a click
// while the same tag was active CLEARED the filter — confusing
// since the chip's affordance reads as "filter to this tag".
//
// The top filter chips (rendered via `<FilterChip>`) keep the
// toggle semantics so users still have an explicit "click the
// active chip again to clear" path; this spec verifies both
// behaviours coexist.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const INDEX_PAYLOAD = {
  action: "index",
  title: "Wiki Index",
  content: "# Wiki Index\n\nRoot page.",
  pageEntries: [
    { title: "Alpha doc", slug: "alpha-doc", description: "", tags: ["shared", "only-alpha"] },
    { title: "Beta doc", slug: "beta-doc", description: "", tags: ["shared", "only-beta"] },
    { title: "Gamma doc", slug: "gamma-doc", description: "", tags: ["only-gamma"] },
  ],
};

test.describe("wiki tag filter — per-entry chip vs top filter", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.route(
      (url) => url.pathname === "/api/wiki",
      (route) => route.fulfill({ json: { data: INDEX_PAYLOAD } }),
    );
  });

  test("entry chip click while same tag is active KEEPS the filter (regression #830)", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.getByTestId("wiki-page-entry-alpha-doc")).toBeVisible();
    await expect(page.getByTestId("wiki-page-entry-gamma-doc")).toBeVisible();

    // Click "shared" chip on the Alpha row — sets filter to "shared".
    await page.getByTestId("wiki-entry-tag-alpha-doc-shared").click();

    // Gamma has no "shared" tag → must be filtered out.
    await expect(page.getByTestId("wiki-page-entry-gamma-doc")).toHaveCount(0);
    // Alpha and Beta both have "shared" → still visible.
    await expect(page.getByTestId("wiki-page-entry-alpha-doc")).toBeVisible();
    await expect(page.getByTestId("wiki-page-entry-beta-doc")).toBeVisible();

    // Click the SAME "shared" tag chip on the Beta row while
    // "shared" is already the active filter. Pre-#830 this called
    // toggleTagFilter and CLEARED the filter (Gamma would reappear).
    // Post-#830 it must keep the filter applied.
    await page.getByTestId("wiki-entry-tag-beta-doc-shared").click();

    // Gamma must STAY hidden — the filter survived the second click.
    await expect(page.getByTestId("wiki-page-entry-gamma-doc")).toHaveCount(0);
    await expect(page.getByTestId("wiki-page-entry-alpha-doc")).toBeVisible();
    await expect(page.getByTestId("wiki-page-entry-beta-doc")).toBeVisible();
  });

  test("top filter chip still toggles the active filter off", async ({ page }) => {
    // Sibling guard: the toggle semantics on the *top* filter chips
    // are intentional and must NOT regress. Set the filter via an
    // entry chip, then clear it by clicking the matching top chip.
    await page.goto("/wiki");
    await expect(page.getByTestId("wiki-page-entry-gamma-doc")).toBeVisible();

    await page.getByTestId("wiki-entry-tag-alpha-doc-shared").click();
    await expect(page.getByTestId("wiki-page-entry-gamma-doc")).toHaveCount(0);

    // Clicking the active "shared" chip in the top filter row
    // clears the filter (toggle semantics preserved there).
    await page.getByTestId("wiki-tag-filter-shared").click();
    await expect(page.getByTestId("wiki-page-entry-gamma-doc")).toBeVisible();
    await expect(page.getByTestId("wiki-page-entry-alpha-doc")).toBeVisible();
    await expect(page.getByTestId("wiki-page-entry-beta-doc")).toBeVisible();
  });

  test("entry chip click switches to a different tag (cross-tag re-filter)", async ({ page }) => {
    // While "shared" is active, clicking an entry chip for
    // "only-alpha" on a still-visible row must switch the filter
    // to "only-alpha" (set, not clear). Sanity check that
    // setTagFilter does the obvious thing in the cross-tag case
    // too — and that the chip we click is one that survived the
    // current filter (gamma's row is hidden under filter=shared,
    // so its chips aren't in the DOM).
    await page.goto("/wiki");
    await expect(page.getByTestId("wiki-page-entry-gamma-doc")).toBeVisible();

    await page.getByTestId("wiki-entry-tag-alpha-doc-shared").click();
    await expect(page.getByTestId("wiki-page-entry-gamma-doc")).toHaveCount(0);

    await page.getByTestId("wiki-entry-tag-alpha-doc-only-alpha").click();
    await expect(page.getByTestId("wiki-page-entry-alpha-doc")).toBeVisible();
    await expect(page.getByTestId("wiki-page-entry-beta-doc")).toHaveCount(0);
    await expect(page.getByTestId("wiki-page-entry-gamma-doc")).toHaveCount(0);
  });
});
