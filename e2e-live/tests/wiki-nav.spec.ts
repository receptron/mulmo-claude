import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { navigateToWikiPage, placeWikiPage, removeWikiPage } from "../fixtures/live-chat.ts";

const L14_TIMEOUT_MS = ONE_MINUTE_MS;

// Each scenario seeds its own pair of wiki pages, so they do not
// share state. Run them in parallel to cut wall time.
test.describe.configure({ mode: "parallel" });

test.describe("wiki navigation (real workspace)", () => {
  test("L-14: wiki ページ内の内部リンクで /chat にリダイレクトされず対象ページが開く", async ({ page }) => {
    test.setTimeout(L14_TIMEOUT_MS);
    // Covers B-23 / B-24 / B-25: the catch-all router used to swallow
    // /wiki/pages/<slug> links and bounce them back to /chat. We seed
    // two pages directly on disk (no LLM authoring drift) and click
    // the rendered <a> in the source page; the test fails if the URL
    // ever leaves the wiki surface.
    const sourceSlug = "e2e-live-l14-source";
    const targetSlug = "e2e-live-l14-target";
    const targetMarker = "L-14 target body marker";
    // mulmoclaude wiki uses double-bracket [[slug]] wikilinks (see
    // src/plugins/wiki/helpers.ts), not plain markdown links —
    // markdown links would be rewritten as Files-view paths and
    // produce a "File not found" view instead of routing to /wiki.
    await placeWikiPage(sourceSlug, [`# L-14 source`, ``, `[[${targetSlug}]]`, ``].join("\n"));
    await placeWikiPage(targetSlug, [`# L-14 target`, ``, targetMarker, ``].join("\n"));
    try {
      await navigateToWikiPage(page, sourceSlug);
      await page.locator(`.wiki-link[data-page="${targetSlug}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/wiki/pages/${encodeURIComponent(targetSlug)}$`));
      await expect(page.getByTestId("wiki-page-body")).toContainText(targetMarker);
      // Negative guard: if the catch-all regression resurfaces, the
      // SPA falls through to /chat (B-24's reported failure mode).
      await expect(page).not.toHaveURL(/\/chat/);
    } finally {
      await removeWikiPage(sourceSlug);
      await removeWikiPage(targetSlug);
    }
  });
});
