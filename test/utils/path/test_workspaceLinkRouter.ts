import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyWorkspacePath, resolveWikiHref } from "../../../src/utils/path/workspaceLinkRouter.js";

describe("classifyWorkspacePath", () => {
  // ── Wiki page links ───────────────────────────────────────

  describe("wiki page links", () => {
    it("classifies data/wiki/pages/<slug>.md as wiki", () => {
      const result = classifyWorkspacePath("data/wiki/pages/my-page.md");
      assert.deepEqual(result, { kind: "wiki", slug: "my-page" });
    });

    it("classifies wiki/pages/<slug>.md (without data/ prefix) as wiki", () => {
      const result = classifyWorkspacePath("wiki/pages/my-page.md");
      assert.deepEqual(result, { kind: "wiki", slug: "my-page" });
    });

    it("extracts multi-segment slug correctly", () => {
      const result = classifyWorkspacePath("data/wiki/pages/some-long-slug-name.md");
      assert.deepEqual(result, { kind: "wiki", slug: "some-long-slug-name" });
    });

    it("does not classify wiki source files as wiki pages", () => {
      const result = classifyWorkspacePath("data/wiki/sources/my-source.md");
      assert.ok(result);
      assert.equal(result.kind, "file");
    });

    it("does not classify wiki index as wiki page", () => {
      const result = classifyWorkspacePath("data/wiki/index.md");
      assert.ok(result);
      assert.equal(result.kind, "file");
    });
  });

  // ── Session links ─────────────────────────────────────────

  describe("session links", () => {
    it("classifies conversations/chat/<id>.jsonl as session", () => {
      const result = classifyWorkspacePath("conversations/chat/abc-123.jsonl");
      assert.deepEqual(result, { kind: "session", sessionId: "abc-123" });
    });

    it("classifies uuid session id", () => {
      const result = classifyWorkspacePath("conversations/chat/550e8400-e29b-41d4-a716-446655440000.jsonl");
      assert.deepEqual(result, { kind: "session", sessionId: "550e8400-e29b-41d4-a716-446655440000" });
    });

    it("does not classify nested paths under chat/ as session", () => {
      const result = classifyWorkspacePath("conversations/chat/sub/dir.jsonl");
      assert.ok(result);
      assert.equal(result.kind, "file");
    });

    it("does not classify non-jsonl files as session", () => {
      const result = classifyWorkspacePath("conversations/chat/abc-123.txt");
      assert.ok(result);
      assert.equal(result.kind, "file");
    });
  });

  // ── File links ────────────────────────────────────────────

  describe("file links", () => {
    it("classifies generic data/ paths as file", () => {
      const result = classifyWorkspacePath("data/some/file.txt");
      assert.deepEqual(result, { kind: "file", path: "data/some/file.txt" });
    });

    it("classifies config paths as file", () => {
      const result = classifyWorkspacePath("config/settings.json");
      assert.deepEqual(result, { kind: "file", path: "config/settings.json" });
    });

    it("normalizes ./ in paths", () => {
      const result = classifyWorkspacePath("./data/wiki/sources/foo.md");
      assert.deepEqual(result, { kind: "file", path: "data/wiki/sources/foo.md" });
    });
  });

  // ── Percent-encoded hrefs ─────────────────────────────────
  // marked.parse encodes multi-byte chars in <a href>, so we receive
  // hrefs like "data/notes/%E3%83%86%E3%82%B9%E3%83%88...md".
  // We MUST decode once before handing the path to vue-router, or the
  // router's own encoding step turns "%E3..." into "%25E3..." (see
  // plans/done/fix-workspace-link-double-encoding.md).

  // ── SPA route links ───────────────────────────────────────
  //
  // Regression for the apps→collections rename PR: agent-emitted
  // links like `[Microsoft](/collections/mc-clients)` were falling
  // into the file fallback and routing to `/files/collections/mc-clients`
  // (404). The classifier now recognizes top-level SPA routes.

  describe("SPA route links", () => {
    it("classifies /collections/<slug> as spa-route", () => {
      const result = classifyWorkspacePath("/collections/mc-clients");
      assert.deepEqual(result, { kind: "spa-route", path: "/collections/mc-clients" });
    });

    it("classifies collections without leading slash as spa-route", () => {
      // marked.parse() can emit either form depending on the source
      // markdown; both should classify the same way.
      const result = classifyWorkspacePath("collections/mc-clients");
      assert.deepEqual(result, { kind: "spa-route", path: "/collections/mc-clients" });
    });

    it("classifies bare /collections (no slug) as spa-route", () => {
      const result = classifyWorkspacePath("/collections");
      assert.deepEqual(result, { kind: "spa-route", path: "/collections" });
    });

    it("classifies /wiki as spa-route", () => {
      const result = classifyWorkspacePath("/wiki");
      assert.deepEqual(result, { kind: "spa-route", path: "/wiki" });
    });

    it("classifies /automations/<id> as spa-route", () => {
      const result = classifyWorkspacePath("/automations/task-1");
      assert.deepEqual(result, { kind: "spa-route", path: "/automations/task-1" });
    });

    // Legacy redirect-only routes (not in PAGE_ROUTES). The router
    // redirects `/calendar` and `/scheduler` to `/automations`, so a
    // historical Markdown link must still classify as an SPA route
    // (and follow the redirect) rather than fall through to
    // `/files/calendar`. See LEGACY_SPA_ROUTE_ALIASES.
    it("classifies legacy /calendar as spa-route (redirects to /automations)", () => {
      assert.deepEqual(classifyWorkspacePath("/calendar"), { kind: "spa-route", path: "/calendar" });
    });

    it("classifies legacy /scheduler as spa-route (redirects to /automations)", () => {
      assert.deepEqual(classifyWorkspacePath("/scheduler"), { kind: "spa-route", path: "/scheduler" });
    });

    it("does NOT classify /skills or /roles as spa-route (moved into the Settings modal; no standalone route)", () => {
      // Skills and Roles are no longer PAGE_ROUTES — they live in the
      // Settings modal now, so SPA_ROUTE_NAMES (auto-derived from
      // PAGE_ROUTES) no longer contains them. A bare `skills` / `roles`
      // segment falls through to file classification, which is correct:
      // `.claude/skills` and `data/skills` are real workspace dirs, so
      // aliasing the segment to a (now defunct) route would shadow them.
      assert.deepEqual(classifyWorkspacePath("/skills"), { kind: "file", path: "skills" });
      assert.deepEqual(classifyWorkspacePath("/roles"), { kind: "file", path: "roles" });
    });

    it("does NOT classify /chat/<id> as spa-route (preserves session-load flow via conversations/chat/<id>.jsonl)", () => {
      // /chat is intentionally excluded from SPA_ROUTE_NAMES so the
      // existing handleSessionSelect path (mark-read, start-chat) is
      // the only way agent links reach a chat session.
      const result = classifyWorkspacePath("/chat/abc-123");
      assert.ok(result);
      assert.equal(result.kind, "file");
    });

    it("does NOT classify /files/<path> as spa-route (preserves per-segment URL encoding)", () => {
      // /files is excluded so the catch-all pathMatch encoding in
      // the file-fallback branch still applies.
      const result = classifyWorkspacePath("/files/data/clients/items/microsoft.json");
      assert.ok(result);
      assert.equal(result.kind, "file");
    });

    it("wiki page pattern still wins over the spa-route catch-all", () => {
      // `wiki` is in SPA_ROUTE_NAMES, but the more specific
      // `data/wiki/pages/<slug>.md` wiki-page pattern is checked
      // first and should still return kind: "wiki".
      const result = classifyWorkspacePath("data/wiki/pages/my-page.md");
      assert.deepEqual(result, { kind: "wiki", slug: "my-page" });
    });

    it("bare /wiki (no page slug) classifies as spa-route", () => {
      // The wiki-page regex requires `pages/<slug>.md` — without
      // that, the SPA-route branch picks it up so `/wiki` opens
      // the wiki home instead of 404ing at `/files/wiki`.
      const result = classifyWorkspacePath("/wiki");
      assert.deepEqual(result, { kind: "spa-route", path: "/wiki" });
    });

    it("does not confuse a file path that happens to start with `data/`", () => {
      // `data` is not a SPA route name, so paths under it stay in
      // the file-fallback branch as expected.
      const result = classifyWorkspacePath("data/clients/items/microsoft.json");
      assert.ok(result);
      assert.equal(result.kind, "file");
      assert.equal((result as { kind: "file"; path: string }).path, "data/clients/items/microsoft.json");
    });

    // Codex P2 review on PR #1490: a file path whose leading
    // segment matches a SPA route name (e.g. `skills/guide.md`,
    // `news/archive.json`) must NOT get reclassified — the SPA
    // route only matches the exact route shape, so pushing such a
    // URL resolves away from the file view and hides the file.

    it("does NOT reclassify `skills/guide.md` as spa-route (looks like a file)", () => {
      const result = classifyWorkspacePath("skills/guide.md");
      assert.ok(result);
      assert.equal(result.kind, "file");
      assert.equal((result as { kind: "file"; path: string }).path, "skills/guide.md");
    });

    it("does NOT reclassify `news/archive.json` as spa-route", () => {
      const result = classifyWorkspacePath("news/archive.json");
      assert.ok(result);
      assert.equal(result.kind, "file");
    });

    it("does NOT reclassify `collections/clients.csv` as spa-route", () => {
      const result = classifyWorkspacePath("collections/clients.csv");
      assert.ok(result);
      assert.equal(result.kind, "file");
    });

    it("still classifies dotless slugs (collections/mc-clients) as spa-route", () => {
      // Sanity: the file-extension heuristic shouldn't false-positive
      // on the common case the original change is meant to handle.
      const result = classifyWorkspacePath("collections/mc-clients");
      assert.deepEqual(result, { kind: "spa-route", path: "/collections/mc-clients" });
    });

    it("treats a slug with a trailing dotted suffix as a file (acceptable false positive)", () => {
      // A slug like `mc-clients.v2` is unusual and would be
      // misclassified as a file. We accept this — slugs with dots
      // are not a real-world pattern and the alternative (slug-shape
      // probe) would be much more complex.
      const result = classifyWorkspacePath("collections/mc-clients.v2");
      assert.ok(result);
      assert.equal(result.kind, "file");
    });
  });

  describe("percent-encoded hrefs (from marked.parse output)", () => {
    it("decodes percent-encoded multibyte file path", () => {
      // "テストファイル" (test file) — generic Japanese name picked
      // so the literal does not look like real user data. The
      // encoded form is what marked.parse() actually emits for a
      // markdown link to this filename.
      const encoded = "data/notes/%E3%83%86%E3%82%B9%E3%83%88%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB.md";
      const result = classifyWorkspacePath(encoded);
      assert.deepEqual(result, {
        kind: "file",
        path: "data/notes/テストファイル.md",
      });
    });

    it("decodes percent-encoded wiki page slug", () => {
      const encoded = "data/wiki/pages/%E3%82%B5%E3%83%B3%E3%83%97%E3%83%AB.md";
      const result = classifyWorkspacePath(encoded);
      assert.deepEqual(result, { kind: "wiki", slug: "サンプル" });
    });

    it("decodes percent-encoded space in filename", () => {
      // marked.parse() encodes literal spaces in href as `%20`, and
      // the on-disk filename carries the literal space. This must
      // round-trip via decodeURIComponent so the file API receives
      // the disk-canonical form. Segments containing `%2F` are the
      // sole exception (plugin-scope opaqueness) — `%20` outside such
      // a segment is ordinary URL transport encoding.
      const result = classifyWorkspacePath("data/some/my%20file.txt");
      assert.deepEqual(result, { kind: "file", path: "data/some/my file.txt" });
    });

    it("falls back to raw href when decode throws on malformed percent sequence", () => {
      // `%E3%83` is a truncated UTF-8 sequence; decodeURIComponent throws
      // URIError. We must not crash — use the raw href so the link still
      // routes (Files view will surface its own 404 if the path is truly bad).
      const malformed = "data/notes/broken-%E3%83.md";
      const result = classifyWorkspacePath(malformed);
      assert.deepEqual(result, { kind: "file", path: "data/notes/broken-%E3%83.md" });
    });

    it("is idempotent for already-decoded multibyte paths", () => {
      const raw = "data/notes/テストファイル.md";
      const result = classifyWorkspacePath(raw);
      assert.deepEqual(result, { kind: "file", path: raw });
    });

    // safeDecode runs per `/`-separated segment. Segments containing
    // `%2F` are kept opaque (plugin-scope disk convention); every
    // other segment is decoded via decodeURIComponent. The tests
    // below pin both halves of that contract.

    it("preserves plugin-scoped %40<scope>%2F<name> as a single literal segment (#1473)", () => {
      // Plugin convention: data/plugins/%40<scope>%2F<name>/ is a
      // SINGLE directory whose name literally contains '%' '4' '0'
      // '%' '2' 'F' characters — not two nested directories. The
      // `%2F` in that segment is what marks it as a plugin-scope
      // token so `safeDecode` leaves it opaque.
      const result = classifyWorkspacePath("data/plugins/%40mulmoclaude%2Fworklog/committed/2026-05.jsonl");
      assert.deepEqual(result, {
        kind: "file",
        path: "data/plugins/%40mulmoclaude%2Fworklog/committed/2026-05.jsonl",
      });
    });

    it("preserves lowercase %2f in a plugin-scope segment (case-insensitive opacity)", () => {
      // The opacity check accepts %2F and %2f interchangeably so both
      // capitalisations round-trip to the disk-canonical name.
      const result = classifyWorkspacePath("data/plugins/%40mulmoclaude%2fworklog/file.md");
      assert.deepEqual(result, {
        kind: "file",
        path: "data/plugins/%40mulmoclaude%2fworklog/file.md",
      });
    });

    it("decodes multibyte while preserving the plugin-scope segment opaque (#1473)", () => {
      // Plugin scope dir name stays opaque, but a Japanese filename
      // inside it gets decoded to its multibyte form so the file API
      // (which receives disk-literal multibyte names) resolves.
      const encoded = "data/plugins/%40mulmoclaude%2Fworklog/%E3%83%A1%E3%83%A2.md";
      const result = classifyWorkspacePath(encoded);
      assert.deepEqual(result, {
        kind: "file",
        path: "data/plugins/%40mulmoclaude%2Fworklog/メモ.md",
      });
    });

    // The tests below pin the original behaviour for non-plugin
    // segments — `safeDecode` falls back to per-segment
    // `decodeURIComponent` when no `%2F` is present, so encoded
    // structural tokens (`%2E%2E` → `..`) get reinterpreted as path
    // structure and the same `normalizePath` root-escape gate applies.

    it("preserves %2F in any segment (opacity rule applies universally)", () => {
      // Synthetic case: a hand-encoded `foo%2Fbar.md` happens to
      // satisfy the opacity rule (segment contains `%2F`), so it
      // stays opaque rather than collapsing into two segments.
      // marked.parse() never emits this shape for legitimate
      // workspace links, so the behaviour is captured here only to
      // make the contract explicit — opacity is segment-local and
      // does not care whether the path is under `data/plugins/`.
      const result = classifyWorkspacePath("data/some/foo%2Fbar.md");
      assert.deepEqual(result, { kind: "file", path: "data/some/foo%2Fbar.md" });
    });

    it("decoded %2E%2E (..) is normalized away within workspace", () => {
      // "data/wiki/pages/%2E%2E/sources/foo.md" → per-segment decode
      // turns the %2E%2E segment into ".." → normalizePath collapses
      // to "data/wiki/sources/foo.md".
      const result = classifyWorkspacePath("data/wiki/pages/%2E%2E/sources/foo.md");
      assert.deepEqual(result, { kind: "file", path: "data/wiki/sources/foo.md" });
    });

    it("decoded %2E%2E that escapes workspace root still returns null", () => {
      // "%2E%2E/%2E%2E/etc/passwd" → per-segment decode → "../../etc/passwd"
      //   → normalizePath pops past root → null. Encoded `..` does
      // not widen the traversal surface beyond what a literal `..`
      // href could already reach.
      const result = classifyWorkspacePath("%2E%2E/%2E%2E/etc/passwd");
      assert.equal(result, null);
    });
  });

  // ── Null returns (external / invalid) ─────────────────────

  describe("returns null for non-workspace links", () => {
    it("returns null for http URLs", () => {
      assert.equal(classifyWorkspacePath("https://example.com"), null);
    });

    it("returns null for http URLs", () => {
      assert.equal(classifyWorkspacePath("http://example.com/path"), null);
    });

    it("returns null for mailto links", () => {
      assert.equal(classifyWorkspacePath("mailto:user@example.com"), null);
    });

    it("returns null for anchor-only links", () => {
      assert.equal(classifyWorkspacePath("#section"), null);
    });

    it("returns null for empty string", () => {
      assert.equal(classifyWorkspacePath(""), null);
    });

    it("returns null for paths that escape the workspace root", () => {
      assert.equal(classifyWorkspacePath("../../../etc/passwd"), null);
    });

    it("returns null for single ../ that escapes root", () => {
      assert.equal(classifyWorkspacePath("../outside.md"), null);
    });
  });

  // ── Wiki relative path resolution ─────────────────────────
  // Wiki pages link to sources/sessions with relative paths like
  // `../sources/foo.md`. The wiki View prepends `data/wiki/pages/`
  // before calling classifyWorkspacePath so that `../` segments
  // resolve correctly against the wiki page's filesystem location.

  describe("wiki relative paths (pre-resolved with data/wiki/pages/ prefix)", () => {
    it("resolves ../sources/<name>.md to a file", () => {
      const resolved = "data/wiki/pages/../sources/my-source.md";
      const result = classifyWorkspacePath(resolved);
      assert.deepEqual(result, { kind: "file", path: "data/wiki/sources/my-source.md" });
    });

    it("resolves ../../../conversations/chat/<id>.jsonl to a session", () => {
      const resolved = "data/wiki/pages/../../../conversations/chat/550e8400-e29b-41d4-a716-446655440000.jsonl";
      const result = classifyWorkspacePath(resolved);
      assert.deepEqual(result, { kind: "session", sessionId: "550e8400-e29b-41d4-a716-446655440000" });
    });

    it("resolves ./other-page.md to a wiki page", () => {
      const resolved = "data/wiki/pages/./other-page.md";
      const result = classifyWorkspacePath(resolved);
      assert.deepEqual(result, { kind: "wiki", slug: "other-page" });
    });

    it("resolves sibling page reference (no prefix needed)", () => {
      const resolved = "data/wiki/pages/sibling.md";
      const result = classifyWorkspacePath(resolved);
      assert.deepEqual(result, { kind: "wiki", slug: "sibling" });
    });
  });

  // ── Fragment / query stripping ────────────────────────────

  describe("strips fragment and query", () => {
    it("strips #fragment from wiki page link", () => {
      const result = classifyWorkspacePath("data/wiki/pages/my-page.md#section");
      assert.deepEqual(result, { kind: "wiki", slug: "my-page" });
    });

    it("strips ?query from file link", () => {
      const result = classifyWorkspacePath("data/file.txt?v=1");
      assert.deepEqual(result, { kind: "file", path: "data/file.txt" });
    });

    it("strips both fragment and query", () => {
      const result = classifyWorkspacePath("data/wiki/pages/foo.md?bar=1#baz");
      assert.deepEqual(result, { kind: "wiki", slug: "foo" });
    });

    it("preserves ?selected= query on a spa-route (collections deep link)", () => {
      const result = classifyWorkspacePath("/collections/mc-invoice?selected=INV-2026-0001");
      assert.deepEqual(result, { kind: "spa-route", path: "/collections/mc-invoice?selected=INV-2026-0001" });
    });

    it("preserves the query but drops the fragment on a spa-route", () => {
      const result = classifyWorkspacePath("/collections/mc-clients?selected=acme#row");
      assert.deepEqual(result, { kind: "spa-route", path: "/collections/mc-clients?selected=acme" });
    });

    it("a spa-route with no query stays query-free", () => {
      const result = classifyWorkspacePath("/collections/mc-invoice");
      assert.deepEqual(result, { kind: "spa-route", path: "/collections/mc-invoice" });
    });

    it("ignores a '?' that lives inside the fragment on a spa-route", () => {
      const result = classifyWorkspacePath("/collections/mc-invoice#frag?notquery");
      assert.deepEqual(result, { kind: "spa-route", path: "/collections/mc-invoice" });
    });

    // `extractQuery` is deliberately NOT the mirror of the shared
    // `stripFragmentAndQuery` (src/utils/path/posixPath.ts), and these two
    // cases pin the asymmetry so it isn't "unified" away: both helpers end
    // the PATH at whichever marker comes first, but only a "?" that
    // precedes any "#" is a router query — a "?" after a "#" is fragment
    // text and must be dropped, not pushed into `route.query`.
    it("keeps a '?' before a '#' as the query", () => {
      const result = classifyWorkspacePath("/collections/mc-invoice?a=1#frag");
      assert.deepEqual(result, { kind: "spa-route", path: "/collections/mc-invoice?a=1" });
    });

    it("drops a '?' after a '#' instead of promoting it to a query", () => {
      const result = classifyWorkspacePath("/collections/mc-invoice#frag?a=1");
      assert.deepEqual(result, { kind: "spa-route", path: "/collections/mc-invoice" });
    });
  });
});

describe("resolveWikiHref", () => {
  const PAGES_BASE = "data/wiki/pages";
  const WIKI_BASE = "data/wiki";

  describe("relative paths (./ and ../)", () => {
    it("prepends baseDir for ../ paths", () => {
      assert.equal(resolveWikiHref("../sources/foo.md", PAGES_BASE), "data/wiki/pages/../sources/foo.md");
    });

    it("prepends baseDir for ./ paths", () => {
      assert.equal(resolveWikiHref("./sibling.md", PAGES_BASE), "data/wiki/pages/./sibling.md");
    });

    it("uses wiki base for log-relative paths", () => {
      assert.equal(resolveWikiHref("./pages/foo.md", WIKI_BASE), "data/wiki/./pages/foo.md");
    });
  });

  describe("bare filenames (no /)", () => {
    it("treats bare .md filename as relative", () => {
      assert.equal(resolveWikiHref("sibling.md", PAGES_BASE), "data/wiki/pages/sibling.md");
    });

    it("treats bare name without extension as relative", () => {
      assert.equal(resolveWikiHref("config", PAGES_BASE), "data/wiki/pages/config");
    });
  });

  describe("external schemes (must pass through unchanged)", () => {
    it("passes through mailto: links", () => {
      assert.equal(resolveWikiHref("mailto:user@example.com", PAGES_BASE), "mailto:user@example.com");
    });

    it("passes through tel: links", () => {
      assert.equal(resolveWikiHref("tel:+819012345678", PAGES_BASE), "tel:+819012345678");
    });

    it("passes through custom scheme links", () => {
      assert.equal(resolveWikiHref("slack://channel/general", PAGES_BASE), "slack://channel/general");
    });

    it("passes through https: links", () => {
      assert.equal(resolveWikiHref("https://example.com", PAGES_BASE), "https://example.com");
    });
  });

  describe("absolute workspace paths (contains /)", () => {
    it("passes through workspace-root-relative paths unchanged", () => {
      assert.equal(resolveWikiHref("data/wiki/sources/foo.md", PAGES_BASE), "data/wiki/sources/foo.md");
    });

    it("passes through conversations path unchanged", () => {
      assert.equal(resolveWikiHref("conversations/chat/abc.jsonl", PAGES_BASE), "conversations/chat/abc.jsonl");
    });
  });
});
