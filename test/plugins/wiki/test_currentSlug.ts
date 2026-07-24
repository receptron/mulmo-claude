import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveWikiSlug } from "../../../src/plugins/wiki/currentSlug.js";

describe("resolveWikiSlug", () => {
  it("prefers the route slug on the wiki pages route", () => {
    assert.equal(resolveWikiSlug({ onWikiRoute: true, onPagesSection: true, routeSlug: "my-page", resultPageName: "other" }), "my-page");
  });

  it("falls back to the tool-result pageName off the wiki route", () => {
    assert.equal(resolveWikiSlug({ onWikiRoute: false, onPagesSection: false, routeSlug: "ignored", resultPageName: "embedded-page" }), "embedded-page");
  });

  it("falls back when on the wiki route but not the pages section", () => {
    assert.equal(resolveWikiSlug({ onWikiRoute: true, onPagesSection: false, routeSlug: "x", resultPageName: "fallback" }), "fallback");
  });

  it("falls back when the route slug is not a string", () => {
    assert.equal(resolveWikiSlug({ onWikiRoute: true, onPagesSection: true, routeSlug: undefined, resultPageName: "fallback" }), "fallback");
  });

  it("returns null when neither source yields a slug", () => {
    assert.equal(resolveWikiSlug({ onWikiRoute: false, onPagesSection: false, routeSlug: undefined, resultPageName: null }), null);
  });

  it("rejects traversal tokens from either source", () => {
    assert.equal(resolveWikiSlug({ onWikiRoute: true, onPagesSection: true, routeSlug: "../secret", resultPageName: null }), null);
    assert.equal(resolveWikiSlug({ onWikiRoute: false, onPagesSection: false, routeSlug: null, resultPageName: "../secret" }), null);
  });

  it("passes a slug with spaces and non-ASCII through unchanged", () => {
    assert.equal(resolveWikiSlug({ onWikiRoute: true, onPagesSection: true, routeSlug: "My Page", resultPageName: null }), "My Page");
    assert.equal(resolveWikiSlug({ onWikiRoute: true, onPagesSection: true, routeSlug: "さくら", resultPageName: null }), "さくら");
  });
});
