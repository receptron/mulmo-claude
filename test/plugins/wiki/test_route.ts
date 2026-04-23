import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildWikiRouteParams, isSafeWikiSlug, readWikiRouteTarget, wikiActionFor } from "../../../src/plugins/wiki/route.js";

describe("isSafeWikiSlug", () => {
  it("accepts plain ASCII slugs", () => {
    assert.equal(isSafeWikiSlug("onboarding"), true);
    assert.equal(isSafeWikiSlug("my-page"), true);
  });

  it("accepts non-ASCII slugs (Japanese etc.)", () => {
    assert.equal(isSafeWikiSlug("さくらインターネット"), true);
    assert.equal(isSafeWikiSlug("café"), true);
  });

  it("rejects the empty string", () => {
    assert.equal(isSafeWikiSlug(""), false);
  });

  it("rejects forward slash (from decoded %2F)", () => {
    // Vue Router decodes `%2F` back to `/` in route.params.slug, so
    // this is the attack that motivated the guard.
    assert.equal(isSafeWikiSlug("a/b"), false);
    assert.equal(isSafeWikiSlug("../secrets"), false);
  });

  it("rejects backslash", () => {
    assert.equal(isSafeWikiSlug("a\\b"), false);
  });

  it("rejects the `..` path token even without a slash", () => {
    assert.equal(isSafeWikiSlug(".."), false);
    assert.equal(isSafeWikiSlug("a..b"), false);
  });

  it("rejects non-string values", () => {
    assert.equal(isSafeWikiSlug(undefined), false);
    assert.equal(isSafeWikiSlug(null), false);
    assert.equal(isSafeWikiSlug(42), false);
    assert.equal(isSafeWikiSlug(["onboarding"]), false);
  });
});

describe("readWikiRouteTarget", () => {
  it("returns index when section is missing", () => {
    assert.deepEqual(readWikiRouteTarget({}), { kind: "index" });
    assert.deepEqual(readWikiRouteTarget({ section: "" }), { kind: "index" });
  });

  it("returns page for `pages/<slug>` with a safe slug", () => {
    assert.deepEqual(readWikiRouteTarget({ section: "pages", slug: "onboarding" }), { kind: "page", slug: "onboarding" });
  });

  it("rejects page when slug is missing", () => {
    // `/wiki/pages` with no trailing segment is nonsensical; the
    // guard redirects it to /wiki.
    assert.equal(readWikiRouteTarget({ section: "pages" }), null);
    assert.equal(readWikiRouteTarget({ section: "pages", slug: "" }), null);
  });

  it("rejects page with unsafe slug (the security-critical path)", () => {
    assert.equal(readWikiRouteTarget({ section: "pages", slug: "../secrets" }), null);
    assert.equal(readWikiRouteTarget({ section: "pages", slug: "a/b" }), null);
    assert.equal(readWikiRouteTarget({ section: "pages", slug: ".." }), null);
  });

  it("returns log / lint_report for their sections", () => {
    assert.deepEqual(readWikiRouteTarget({ section: "log" }), { kind: "log" });
    assert.deepEqual(readWikiRouteTarget({ section: "lint-report" }), { kind: "lint_report" });
  });

  it("rejects unknown sections", () => {
    // The router's `(pages|log|lint-report)` regex already rejects
    // these at the routing layer; this is belt-and-suspenders for
    // callers that build params by hand.
    assert.equal(readWikiRouteTarget({ section: "garbage" }), null);
    assert.equal(readWikiRouteTarget({ section: "LINT-REPORT" }), null);
  });

  it("rejects non-object input", () => {
    assert.equal(readWikiRouteTarget(null), null);
    assert.equal(readWikiRouteTarget(undefined), null);
    assert.equal(readWikiRouteTarget("pages"), null);
  });
});

describe("buildWikiRouteParams", () => {
  it("returns empty strings for index so vue-router clears stale optional params", () => {
    // Named-route navigation does NOT clear optional params unless
    // they're explicitly set. Returning `{}` would leak the previous
    // `section`/`slug` when navigating from `/wiki/pages/foo` back
    // to the index, leaving the URL stuck on the page route. Empty
    // strings tell the router to write out the bare `/wiki` path.
    assert.deepEqual(buildWikiRouteParams({ kind: "index" }), { section: "", slug: "" });
  });

  it("builds page params", () => {
    assert.deepEqual(buildWikiRouteParams({ kind: "page", slug: "onboarding" }), { section: "pages", slug: "onboarding" });
  });

  it("builds log / lint_report params with slug explicitly cleared (kebab-case URL)", () => {
    // Same optional-param leak concern as the index case: slug needs
    // to be explicitly "" so `/wiki/pages/foo` → log navigation
    // doesn't produce `/wiki/log/foo`.
    assert.deepEqual(buildWikiRouteParams({ kind: "log" }), { section: "log", slug: "" });
    assert.deepEqual(buildWikiRouteParams({ kind: "lint_report" }), { section: "lint-report", slug: "" });
  });

  it("round-trips through readWikiRouteTarget", () => {
    const targets = [{ kind: "index" as const }, { kind: "page" as const, slug: "my-page" }, { kind: "log" as const }, { kind: "lint_report" as const }];
    for (const target of targets) {
      assert.deepEqual(readWikiRouteTarget(buildWikiRouteParams(target)), target);
    }
  });
});

describe("wikiActionFor", () => {
  it("maps each target kind to the server-side action name", () => {
    assert.equal(wikiActionFor({ kind: "index" }), "index");
    assert.equal(wikiActionFor({ kind: "page", slug: "x" }), "page");
    assert.equal(wikiActionFor({ kind: "log" }), "log");
    // The single place URL and action diverge (kebab → underscore).
    assert.equal(wikiActionFor({ kind: "lint_report" }), "lint_report");
  });
});
