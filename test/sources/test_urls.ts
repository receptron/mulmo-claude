import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, stableItemId } from "../../server/workspace/sources/urls.js";

describe("normalizeUrl — happy path", () => {
  it("returns a canonical form for a plain URL", () => {
    assert.equal(normalizeUrl("https://example.com/a/b"), "https://example.com/a/b");
  });

  it("lowercases protocol and hostname", () => {
    assert.equal(normalizeUrl("HTTPS://EXAMPLE.COM/path"), "https://example.com/path");
  });

  it("drops the fragment", () => {
    assert.equal(normalizeUrl("https://example.com/p#section"), "https://example.com/p");
  });

  it("collapses a trailing slash on non-root paths", () => {
    assert.equal(normalizeUrl("https://example.com/path/"), "https://example.com/path");
  });

  it("preserves the root slash", () => {
    // "/"-only path is semantically different from no path; don't
    // collapse it to empty.
    assert.equal(normalizeUrl("https://example.com/"), "https://example.com/");
  });

  it("drops default ports", () => {
    assert.equal(normalizeUrl("https://example.com:443/x"), "https://example.com/x");
    assert.equal(normalizeUrl("http://example.com:80/x"), "http://example.com/x");
  });

  it("keeps non-default ports", () => {
    assert.equal(normalizeUrl("https://example.com:8443/x"), "https://example.com:8443/x");
  });
});

describe("normalizeUrl — tracking params", () => {
  it("strips utm_* params", () => {
    const out = normalizeUrl("https://example.com/x?utm_source=hn&utm_medium=rss&utm_campaign=foo");
    assert.equal(out, "https://example.com/x");
  });

  it("strips fbclid / gclid / msclkid", () => {
    for (const param of ["fbclid", "gclid", "msclkid", "dclid", "yclid"]) {
      const out = normalizeUrl(`https://example.com/x?${param}=xyz`);
      assert.equal(out, "https://example.com/x", `expected ${param} stripped`);
    }
  });

  it("strips mc_* mailchimp params", () => {
    const out = normalizeUrl("https://example.com/x?mc_cid=abc&mc_eid=def");
    assert.equal(out, "https://example.com/x");
  });

  it("preserves non-tracking query params", () => {
    assert.equal(normalizeUrl("https://example.com/search?q=hello"), "https://example.com/search?q=hello");
  });

  it("mixes tracking strip with preservation", () => {
    assert.equal(normalizeUrl("https://example.com/search?q=hello&utm_source=news&fbclid=zzz&lang=ja"), "https://example.com/search?lang=ja&q=hello");
  });

  it("is case-insensitive on tracking param names", () => {
    assert.equal(normalizeUrl("https://example.com/x?UTM_Source=foo"), "https://example.com/x");
  });
});

describe("normalizeUrl — query param sorting", () => {
  it("sorts remaining params alphabetically", () => {
    // Sorting makes different-ordered links dedup correctly.
    assert.equal(normalizeUrl("https://example.com/x?z=1&a=2&m=3"), "https://example.com/x?a=2&m=3&z=1");
  });

  it("preserves multi-value params in their relative order", () => {
    // ?t=1&t=2 and ?t=2&t=1 are semantically different; we must
    // not reorder within the same key.
    const out = normalizeUrl("https://example.com/x?t=1&t=2&a=0");
    assert.equal(out, "https://example.com/x?a=0&t=1&t=2");
  });
});

describe("normalizeUrl — invalid input", () => {
  it("returns null for empty / whitespace", () => {
    assert.equal(normalizeUrl(""), null);
    assert.equal(normalizeUrl("   "), null);
  });

  it("returns null for non-string input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal(normalizeUrl(null as any), null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal(normalizeUrl(42 as any), null);
  });

  it("returns null for malformed URLs", () => {
    assert.equal(normalizeUrl("not a url"), null);
    assert.equal(normalizeUrl("http://"), null);
  });

  it("parses uncommon but valid schemes", () => {
    // File URLs are valid; the caller decides whether to register
    // them. Normalizer should still produce a clean href.
    const out = normalizeUrl("file:///tmp/x.html");
    assert.equal(out, "file:///tmp/x.html");
  });
});

describe("stableItemId", () => {
  it("is deterministic for the same input", () => {
    assert.equal(stableItemId("https://example.com/a"), stableItemId("https://example.com/a"));
  });

  it("differs for different inputs", () => {
    assert.notEqual(stableItemId("https://example.com/a"), stableItemId("https://example.com/b"));
  });

  it("is always 16 hex chars (SHA-256 truncated to 64 bits)", () => {
    for (const input of ["", "x", "https://example.com/a", "https://example.com/" + "x".repeat(1000)]) {
      const id = stableItemId(input);
      assert.equal(id.length, 16);
      assert.match(id, /^[0-9a-f]{16}$/);
    }
  });

  it("produces different ids for normalized vs unnormalized", () => {
    // Sanity: the caller is expected to hash the normalized form
    // so two different-looking inputs collapse to one id only
    // when the caller does the normalize step.
    assert.notEqual(stableItemId("https://example.com/a"), stableItemId("https://example.com/a?utm_source=x"));
  });
});
