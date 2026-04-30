import { type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import {
  navigateToWikiPage,
  placeFixtureInWorkspace,
  placeWikiPage,
  readImgNaturalSizeInWiki,
  readImgSrcInWiki,
  removeFromWorkspace,
  removeWikiPage,
  waitForImgInWiki,
} from "../fixtures/live-chat.ts";

// Wiki tests are read-only against the LLM (the page body is seeded
// directly to disk and the SPA renders it via the standard wiki
// route), so they do not actually call Claude. They live in
// `e2e-live/` because they verify the end-to-end image-path pipeline
// against a live mulmoclaude server, exactly the surface the
// markdown-image-coverage umbrella issue (#1011) targets.

const SPEC_TIMEOUT_MS = ONE_MINUTE_MS;

// Each scenario seeds its own slug + image, so they don't share
// state. Run in parallel to cut wall time — same justification as
// `media.spec.ts`.
test.describe.configure({ mode: "parallel" });

test.describe("wiki image coverage (real workspace)", () => {
  test("L-W-S-01: raw <img src='../../../artifacts/images/...'> renders (Stage A — markdown rewriter handles raw <img>)", async ({ page }) => {
    test.setTimeout(SPEC_TIMEOUT_MS);
    const slug = "e2e-live-l-w-s-01";
    const workspaceImageRel = "artifacts/images/e2e-live-l-w-s-01.png";
    await placeFixtureInWorkspace("images/sample.png", workspaceImageRel);
    await placeWikiPage(slug, ["# L-W-S-01", "", '<img src="../../../artifacts/images/e2e-live-l-w-s-01.png" alt="raw" />', ""].join("\n"));
    try {
      await navigateToWikiPage(page, slug);
      await waitForImgInWiki(page, 'img[alt="raw"]');
      await assertImgDecodes(page, 'img[alt="raw"]');
    } finally {
      await removeWikiPage(slug);
      await removeFromWorkspace(workspaceImageRel);
    }
  });

  test("L-W-S-02: markdown image ![](url) renders (regression on the always-supported path)", async ({ page }) => {
    test.setTimeout(SPEC_TIMEOUT_MS);
    const slug = "e2e-live-l-w-s-02";
    const workspaceImageRel = "artifacts/images/e2e-live-l-w-s-02.png";
    await placeFixtureInWorkspace("images/sample.png", workspaceImageRel);
    await placeWikiPage(slug, ["# L-W-S-02", "", "![md](../../../artifacts/images/e2e-live-l-w-s-02.png)", ""].join("\n"));
    try {
      await navigateToWikiPage(page, slug);
      await waitForImgInWiki(page, 'img[alt="md"]');
      await assertImgDecodes(page, 'img[alt="md"]');
    } finally {
      await removeWikiPage(slug);
      await removeFromWorkspace(workspaceImageRel);
    }
  });

  // L-W-S-03 (`<picture><source>...<img></picture>`) depends on
  // Stage B widening the rewriter to `<source>` / `<video poster>`.
  // Until that lands, the inner `<img>` does get rewritten by
  // Stage A but the `<source srcset>` siblings would 404. Skipped
  // on purpose so it stays visible in the report as a pending item.
  test.skip("L-W-S-03: <picture><source><img></picture> renders (depends on Stage B / #1011)", async () => {});

  test("L-W-S-04: broken-prefix <img> is repaired by useGlobalImageErrorRepair", async ({ page }) => {
    test.setTimeout(SPEC_TIMEOUT_MS);
    const slug = "e2e-live-l-w-s-04";
    const filename = "e2e-live-l-w-s-04.png";
    const workspaceImageRel = `artifacts/images/${filename}`;
    await placeFixtureInWorkspace("images/sample.png", workspaceImageRel);
    // Wrong prefix — only the trailing `artifacts/images/<file>`
    // segment matches the repair pattern. Self-repair must rewrite
    // the src to `/${match}` so the static mount serves it.
    await placeWikiPage(slug, ["# L-W-S-04", "", `<img src="/wrong/prefix/artifacts/images/${filename}" alt="repair" />`, ""].join("\n"));
    try {
      await navigateToWikiPage(page, slug);
      await waitForImgInWiki(page, 'img[alt="repair"]');
      // After repair, the resolved src must contain the artifacts
      // path. The unresolved attribute may still read the original
      // wrong-prefix string until the repair fires; assert via
      // naturalWidth instead, which is the actual end-to-end signal.
      await assertImgDecodes(page, 'img[alt="repair"]');
      const repairedSrc = await readImgSrcInWiki(page, 'img[alt="repair"]');
      expect(repairedSrc, "self-repair must point the src at /artifacts/...").toContain(`artifacts/images/${filename}`);
    } finally {
      await removeWikiPage(slug);
      await removeFromWorkspace(workspaceImageRel);
    }
  });

  test("L-W-S-05: relative reference under data/wiki/sources/ renders", async ({ page }) => {
    test.setTimeout(SPEC_TIMEOUT_MS);
    const slug = "e2e-live-l-w-s-05";
    const filename = "e2e-live-l-w-s-05.png";
    const workspaceImageRel = `data/wiki/sources/${filename}`;
    await placeFixtureInWorkspace("images/sample.png", workspaceImageRel);
    // Relative path from `data/wiki/pages/<slug>.md` up to `sources/`.
    await placeWikiPage(slug, ["# L-W-S-05", "", `![local](../sources/${filename})`, ""].join("\n"));
    try {
      await navigateToWikiPage(page, slug);
      await waitForImgInWiki(page, 'img[alt="local"]');
      await assertImgDecodes(page, 'img[alt="local"]');
    } finally {
      await removeWikiPage(slug);
      await removeFromWorkspace(workspaceImageRel);
    }
  });
});

/**
 * Wait for the image to load and assert it has non-zero natural
 * dimensions. `naturalWidth = 0` is the canonical "broken image"
 * signal — survives 404s, blocked sandboxes, and decode failures.
 */
async function assertImgDecodes(page: Page, imgSelector: string): Promise<void> {
  const size = await readImgNaturalSizeInWiki(page, imgSelector);
  if (size === null) {
    throw new Error(`expected an <img> matching ${imgSelector} inside the wiki body`);
  }
  expect(size.width, `${imgSelector} must actually decode (naturalWidth > 0)`).toBeGreaterThan(0);
  expect(size.height).toBeGreaterThan(0);
}
