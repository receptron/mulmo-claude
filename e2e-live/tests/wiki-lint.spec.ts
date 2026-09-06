import { randomUUID } from "node:crypto";

import { type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { placeWikiPage, removeWikiPage, replaceWikiIndex, restoreWikiIndex } from "../fixtures/live-chat.ts";

// `/wiki/lint-report` diagnostic coverage. All six tests assert that
// a specific issue category surfaces in the lint output:
//   - L-WIKI-LINT-EMPTY-TARGET  → [[|alias]]        → "empty target"
//   - L-WIKI-LINT-NON-ASCII     → [[日本語]]         → "<題名>.md not found"
//   - L-WIKI-LINT-BROKEN        → [[bogus-slug]]    → "broken link"
//   - L-WIKI-LINT-ORPHAN        → page on disk not in index.md
//   - L-WIKI-LINT-MISSING       → index row pointing at a missing file
//   - L-WIKI-LINT-TAG-DRIFT     → frontmatter vs index hashtag drift
//
// The first four never touch `data/wiki/index.md` and run in parallel.
// The last two replace `index.md` and live in a `describe.serial`
// block so one test's restore can't race a sibling's replace.
//
// `[[slug|alias]]` lint false-positive coverage (L-WIKI-LINT-PIPE-CLEAN)
// lives in wiki-piped-links.spec.ts next to its renderer counterpart.

// Navigate to the wiki lint report and wait for the body-side h1 to
// render. Body-scoped because the panel chrome also has its own
// "Wiki Lint Report" h2 — a top-level `getByRole` would otherwise
// hit strict-mode violation on two matching elements.
const navigateToWikiLintReport = async (page: Page): Promise<void> => {
  await page.goto("/wiki/lint-report");
  await expect(page.getByTestId("wiki-page-body").getByRole("heading", { name: "Wiki Lint Report" })).toBeVisible();
};

test.describe.configure({ mode: "parallel" });

test.describe("wiki lint diagnostics (real workspace)", () => {
  test("L-WIKI-LINT-EMPTY-TARGET: lint レポート画面で [[|alias]] が empty target 診断に出る", async ({ page }, testInfo) => {
    test.setTimeout(ONE_MINUTE_MS);
    // Covers PR #1312's "empty target" diagnostic. A `[[|alias]]` body
    // has nothing before the pipe, so the target is empty and there is
    // no slug to look up — distinct from a target that names a page
    // which happens not to exist. Flagged separately so an author can
    // tell a malformed link from a missing one.
    //
    // This used to seed a bare Japanese target, which collapsed to an
    // empty slug under `wikiSlugify`. #2940 changed that on purpose —
    // a Japanese page filename IS its slug — so that case now belongs
    // to L-WIKI-LINT-NON-ASCII below and this one uses the shape that
    // is still genuinely empty.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const sourceSlug = `e2e-live-wiki-lint-empty-source-${projectSlug}-${nonce}`;
    // The alias carries the nonce so the assertion scopes to this run
    // even though the target itself is empty by construction.
    const alias = `empty-alias-${nonce}`;
    try {
      await placeWikiPage(sourceSlug, [`# wiki-lint-empty source`, ``, `[[|${alias}]]`, ``].join("\n"));
      await navigateToWikiLintReport(page);
      // Positive: an "empty target" entry naming our source file.
      await expect(
        page.locator(`li:has-text("${sourceSlug}"):has-text("${alias}"):has-text("empty target")`),
        "lint must report [[|alias]] as an empty target diagnostic",
      ).toHaveCount(1);
      // Negative: it must not ALSO be reported as a missing file —
      // "<slug>.md not found" would invite creating a page for a link
      // that names none.
      await expect(
        page.locator(`li:has-text("${sourceSlug}"):has-text("${alias}"):has-text("not found")`),
        "empty-target case must not also surface as a 'not found' broken link",
      ).toHaveCount(0);
    } finally {
      await removeWikiPage(sourceSlug);
    }
  });

  test("L-WIKI-LINT-NON-ASCII: lint レポート画面で bare [[日本語]] が <題名>.md not found 診断に出る", async ({ page }, testInfo) => {
    test.setTimeout(ONE_MINUTE_MS);
    // Pins #2940 end to end. A page file may be NAMED in Japanese, so
    // the stem is the slug and a missing one must read `<題名>.md not
    // found` — actionable, because that is the file you would create.
    // Before #2940 `wikiSlugify` stripped every character and the link
    // was reported as an "empty target", which described the link as
    // malformed when it was merely missing.
    //
    // The unit test in `packages/core/test/wiki/test_lint.ts` pins the
    // same rule ("reports a missing non-ASCII target as a broken link,
    // not an empty target"); this one pins that the lint REPORT shows
    // it. No target page is seeded — by design the link cannot resolve.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const sourceSlug = `e2e-live-wiki-lint-nonascii-source-${projectSlug}-${nonce}`;
    // ASCII-free by construction: any surviving ASCII would change the
    // stem and blur what this test is pinning. Per-test uniqueness comes
    // from `sourceSlug`, which the `<li>` filter scopes on.
    const bareJapaneseTarget = "日本語のみのターゲット記号終端タイトル";
    try {
      await placeWikiPage(sourceSlug, [`# wiki-lint-nonascii source`, ``, `[[${bareJapaneseTarget}]]`, ``].join("\n"));
      await navigateToWikiLintReport(page);
      // Positive: the missing page is named verbatim, with the `.md`
      // stem the author would create.
      await expect(
        page.locator(`li:has-text("${sourceSlug}"):has-text("${bareJapaneseTarget}.md"):has-text("not found")`),
        "lint must report a missing non-ASCII target as '<題名>.md not found'",
      ).toHaveCount(1);
      // Negative: it must NOT be reported as an empty target — that is
      // the pre-#2940 behaviour this test exists to prevent regressing to.
      await expect(
        page.locator(`li:has-text("${sourceSlug}"):has-text("${bareJapaneseTarget}"):has-text("empty target")`),
        "a missing non-ASCII target must not be reported as an empty target (#2940)",
      ).toHaveCount(0);
    } finally {
      await removeWikiPage(sourceSlug);
    }
  });

  test("L-WIKI-LINT-BROKEN: lint レポート画面で [[bogus-slug]] が broken link 診断に出る", async ({ page }, testInfo) => {
    test.setTimeout(ONE_MINUTE_MS);
    // General sanity: the broken-link diagnostic itself still works
    // post-fix. Distinct from L-WIKI-LINT-EMPTY-TARGET (Japanese
    // → empty slug) and L-WIKI-LINT-PIPE-CLEAN (alias must NOT
    // false-positive). Here a plain ASCII slug references a file
    // that doesn't exist — the canonical broken-link case the user
    // would encounter when typoing or deleting a target page.
    //
    // No target page is seeded — by design the link cannot resolve.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const sourceSlug = `e2e-live-wiki-lint-broken-source-${projectSlug}-${nonce}`;
    const bogusTargetSlug = `e2e-live-wiki-lint-broken-bogus-${projectSlug}-${nonce}`;
    try {
      await placeWikiPage(sourceSlug, [`# wiki-lint-broken source`, ``, `[[${bogusTargetSlug}]]`, ``].join("\n"));
      await navigateToWikiLintReport(page);
      // Positive: an entry naming both the source file and the bogus
      // target's `<slug>.md not found` form must appear. The
      // `bogusTargetSlug` substring also implicitly checks that the
      // resolver did NOT slugify it down to an empty string — it
      // is plain ASCII and must survive verbatim.
      await expect(
        page.locator(`li:has-text("${sourceSlug}"):has-text("${bogusTargetSlug}.md not found")`),
        "lint must report [[bogus-slug]] as broken link with '<slug>.md not found' shape",
      ).toHaveCount(1);
    } finally {
      await removeWikiPage(sourceSlug);
    }
  });

  test("L-WIKI-LINT-ORPHAN: lint レポート画面で index.md にない page が orphan 診断に出る", async ({ page }, testInfo) => {
    test.setTimeout(ONE_MINUTE_MS);
    // Covers `findOrphanPages` end-to-end. Any `<slug>.md` on disk
    // that the index does not reference must surface as the
    // dedicated "Orphan page" diagnostic — pre-fix this was merged
    // with the broken-link line and operators could not filter the
    // two cases apart.
    //
    // No index mutation is needed: the user's existing
    // `data/wiki/index.md` will not reference our nonce-stamped
    // slug, so seeding just the page file produces a deterministic
    // orphan. That keeps this test parallel-safe and lets it run
    // alongside the other non-mutating L-WIKI-LINT-* tests above.
    //
    // The lint report aggregates every orphan on disk, so other
    // parallel tests' transiently-seeded source pages (L-WIKI-PIPE
    // et al.) may also surface here while they run. That is fine:
    // the assertion is scoped to our unique slug via `:has-text`,
    // not to a total orphan count.
    const testLabel = (testInfo.title.split(":")[0] ?? "").trim().toLowerCase();
    const nonce = `${testLabel}-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const orphanSlug = `e2e-live-wiki-lint-orphan-${testInfo.project.name}-${nonce}`;
    try {
      await placeWikiPage(orphanSlug, [`# wiki-lint-orphan ${nonce}`, ``, `orphan body ${nonce}`, ``].join("\n"));
      await navigateToWikiLintReport(page);
      // Diagnostic shape: `**Orphan page**: \`<slug>.md\` exists
      // but is missing from index.md`. Anchor on all three tokens
      // (slug + "Orphan page" + "missing from index.md") so the
      // assertion only matches the dedicated diagnostic and not,
      // e.g., a future "<slug>.md not found" line that happened
      // to mention the same slug.
      await expect(
        page.locator(`li:has-text("${orphanSlug}.md"):has-text("Orphan page"):has-text("missing from index.md")`),
        "lint must report the seeded page as an orphan diagnostic",
      ).toHaveCount(1);
    } finally {
      await removeWikiPage(orphanSlug);
    }
  });

  // The two diagnostics below both replace `data/wiki/index.md`
  // for the duration of the test. The shared `replaceWikiIndex`
  // helper has no internal locking, so they MUST run serially with
  // respect to each other; without this fence one test's
  // `restoreWikiIndex` would race against a sibling's
  // `replaceWikiIndex`, leaving the workspace in a hybrid state.
  // The outer describe stays parallel — the EMPTY-TARGET / BROKEN /
  // ORPHAN tests above do not touch index.md and can run alongside
  // this block without contention. Any future test that mutates
  // index.md MUST move inside this block (or a sibling serial block).
  test.describe.serial("wiki index-mutating lint diagnostics", () => {
    test("L-WIKI-LINT-MISSING: lint レポート画面で index.md が参照する未存在 file が missing 診断に出る", async ({ page }, testInfo) => {
      test.setTimeout(ONE_MINUTE_MS);
      // Covers `findMissingFiles` end-to-end. An index.md row that
      // references a slug whose `<slug>.md` does not exist on disk
      // must surface as "Missing file". This is the symmetric
      // partner to "Orphan page" — together they let operators
      // reconcile the index vs. the pages directory.
      //
      // We replace `data/wiki/index.md` with a synthetic row that
      // points at a nonce-stamped slug we never seed. Restoration
      // happens in `finally` via the standard `replaceWikiIndex` →
      // `restoreWikiIndex` round trip (see L-16's iter-2 fix in
      // wiki-nav.spec.ts for the null-vs-empty restore semantics
      // this inherits).
      const testLabel = (testInfo.title.split(":")[0] ?? "").trim().toLowerCase();
      const nonce = `${testLabel}-${Date.now()}-${randomUUID().slice(0, 6)}`;
      const bogusSlug = `e2e-live-wiki-lint-missing-${testInfo.project.name}-${nonce}`;
      // Sentinel page so `pages/` is non-empty when the lint route
      // runs. `collectLintIssues` (server/api/routes/wiki.ts) short-
      // circuits with a single "Wiki `pages/` directory does not
      // exist yet" message when `slugs.size === 0` — bypassing
      // `findMissingFiles` entirely. Locally this never fires
      // because the developer workspace usually has user-owned wiki
      // pages, but CI starts from a fresh workspace; by the time
      // this serial-block test runs, the parallel block's
      // transient pages have all been cleaned up, so pages/ is
      // empty. Seeding a single sentinel here keeps the guard off
      // the critical path. The sentinel itself shows up as an
      // Orphan-page diagnostic (it's not in our synthetic index),
      // which does not collide with the Missing-file assertion
      // below (different slug, different diagnostic phrase).
      const sentinelSlug = `e2e-live-wiki-lint-missing-sentinel-${testInfo.project.name}-${nonce}`;
      // Bullet-link form is what `parseBulletLinkRow` reads to
      // recover entry.slug from the href — same shape L-16 uses.
      const newIndex = ["# Wiki Index", "", `- [${bogusSlug} title](pages/${bogusSlug}.md) — missing-file canary`, ""].join("\n");
      let originalIndex: string | null = null;
      let replacedIndex = false;
      try {
        await placeWikiPage(sentinelSlug, [`# sentinel ${nonce}`, ``, `keeps data/wiki/pages/ non-empty`, ``].join("\n"));
        originalIndex = await replaceWikiIndex(newIndex);
        replacedIndex = true;
        await navigateToWikiLintReport(page);
        // Diagnostic shape: `**Missing file**: index.md references
        // \`<slug>\` but the file does not exist`. Anchor on slug
        // + "Missing file" + "does not exist" so the assertion is
        // narrowly scoped to our seeded entry, even if the
        // workspace has unrelated missing-file diagnostics.
        await expect(
          page.locator(`li:has-text("${bogusSlug}"):has-text("Missing file"):has-text("does not exist")`),
          "lint must report the seeded index row as a missing-file diagnostic",
        ).toHaveCount(1);
      } finally {
        if (replacedIndex) await restoreWikiIndex(originalIndex);
        await removeWikiPage(sentinelSlug);
      }
    });

    test("L-WIKI-LINT-TAG-DRIFT: lint レポート画面で frontmatter tag と index tag の drift が診断に出る", async ({ page }, testInfo) => {
      test.setTimeout(ONE_MINUTE_MS);
      // Covers `findTagDrift` end-to-end. A page whose YAML
      // frontmatter `tags:` differs from the matching index row's
      // hashtag set must surface as "Tag drift" — pre-fix it
      // surfaced as a generic warning that operators could not
      // filter. The page exists (no Missing file noise) AND is in
      // the index (no Orphan page noise) so the assertion can
      // anchor narrowly on the drift diagnostic itself.
      //
      // Both the page body and the index row need to be seeded.
      // The shared `data/wiki/index.md` is mutated → serial block.
      const testLabel = (testInfo.title.split(":")[0] ?? "").trim().toLowerCase();
      const nonce = `${testLabel}-${Date.now()}-${randomUUID().slice(0, 6)}`;
      const slug = `e2e-live-wiki-lint-drift-${testInfo.project.name}-${nonce}`;
      // Tag tokens use only lowercase ASCII + hyphens + digits so
      // both `parseFrontmatterTags` (post-`cleanTagToken`) and
      // `extractHashTags` (whose regex allows `\p{L}\p{N}_-`) keep
      // them verbatim. Distinct tags on each side so the drift
      // condition is unambiguous (set inequality).
      const pageTag = `pageonly-${nonce}`;
      const indexTag = `indexonly-${nonce}`;
      // YAML block-list frontmatter — js-yaml parses both flow
      // (`tags: [a, b]`) and block forms, but the block form is
      // unambiguous and survives a future parseFrontmatter rewrite
      // that drops flow support.
      const pageBody = ["---", `tags:`, `  - ${pageTag}`, "---", "", `# ${slug}`, "", `drift body ${nonce}`, ""].join("\n");
      // Bullet-link row with the index-side tag tucked into the
      // description via `#<tag>` (extractHashTags reads it from
      // the description line). Keep the slug in the href so
      // `parseBulletLinkRow` recovers entry.slug = slug.
      const newIndex = ["# Wiki Index", "", `- [${slug} title](pages/${slug}.md) — drift canary #${indexTag}`, ""].join("\n");
      let originalIndex: string | null = null;
      let replacedIndex = false;
      try {
        await placeWikiPage(slug, pageBody);
        originalIndex = await replaceWikiIndex(newIndex);
        replacedIndex = true;
        await navigateToWikiLintReport(page);
        // Diagnostic shape: `**Tag drift**: \`<slug>.md\`
        // frontmatter has [pageonly...] but index.md has
        // [indexonly...]`. Both tag tokens are nonce-stamped so
        // the same <li> can be uniquely identified by joining the
        // slug + "Tag drift" + both tokens — no risk of a partial
        // match landing on an unrelated diagnostic.
        await expect(
          page.locator(`li:has-text("${slug}.md"):has-text("Tag drift"):has-text("${pageTag}"):has-text("${indexTag}")`),
          "lint must report the seeded slug as a tag-drift diagnostic",
        ).toHaveCount(1);
      } finally {
        if (replacedIndex) await restoreWikiIndex(originalIndex);
        await removeWikiPage(slug);
      }
    });
  });
});
