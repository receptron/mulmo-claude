import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRobots, selectGroup, isAllowedByRobots, matchesPattern } from "../../server/workspace/sources/robots.js";

// --- parseRobots -----------------------------------------------------------

describe("parseRobots — structural", () => {
  it("returns an empty group list for empty input", () => {
    assert.deepEqual(parseRobots("").groups, []);
    assert.deepEqual(parseRobots("\n\n\n").groups, []);
  });

  it("strips comments and blank lines", () => {
    const out = parseRobots(`
# this is a comment
User-agent: *   # trailing comment
Disallow: /private
`);
    assert.equal(out.groups.length, 1);
    assert.deepEqual(out.groups[0].userAgents, ["*"]);
    assert.equal(out.groups[0].rules.length, 1);
    assert.equal(out.groups[0].rules[0].kind, "disallow");
    assert.equal(out.groups[0].rules[0].pattern, "/private");
  });

  it("groups multiple User-agent lines before the first rule", () => {
    // robots.txt allows `User-agent: A\nUser-agent: B\nDisallow: /`
    // to share one group — both agents see the same rules.
    const out = parseRobots(`
User-agent: Googlebot
User-agent: Bingbot
Disallow: /search
`);
    assert.equal(out.groups.length, 1);
    assert.deepEqual(out.groups[0].userAgents, ["googlebot", "bingbot"]);
  });

  it("starts a new group when a User-agent appears after rules", () => {
    const out = parseRobots(`
User-agent: A
Disallow: /x
User-agent: B
Disallow: /y
`);
    assert.equal(out.groups.length, 2);
    assert.deepEqual(out.groups[0].userAgents, ["a"]);
    assert.deepEqual(out.groups[1].userAgents, ["b"]);
  });

  it("captures Crawl-delay per group", () => {
    const out = parseRobots(`
User-agent: *
Crawl-delay: 5
Disallow: /slow
`);
    assert.equal(out.groups[0].crawlDelaySec, 5);
  });

  it("ignores unknown directives", () => {
    const out = parseRobots(`
User-agent: *
Sitemap: https://example.com/sitemap.xml
Request-rate: 1/10s
Host: example.com
Disallow: /x
`);
    assert.equal(out.groups.length, 1);
    assert.equal(out.groups[0].rules.length, 1);
  });

  it("tolerates CRLF line endings", () => {
    const crlf = "User-agent: *\r\nDisallow: /x\r\n";
    const out = parseRobots(crlf);
    assert.equal(out.groups[0].userAgents[0], "*");
    assert.equal(out.groups[0].rules[0].pattern, "/x");
  });

  it("is case-insensitive on directive names but not on values", () => {
    const out = parseRobots(`
USER-AGENT: Googlebot
DISALLOW: /Search
`);
    assert.equal(out.groups[0].userAgents[0], "googlebot");
    assert.equal(out.groups[0].rules[0].pattern, "/Search"); // case preserved
  });

  it("skips malformed lines (no colon, empty directive)", () => {
    const out = parseRobots(`
garbage
User-agent: *
: empty directive
Disallow: /ok
`);
    assert.equal(out.groups.length, 1);
    assert.equal(out.groups[0].rules.length, 1);
    assert.equal(out.groups[0].rules[0].pattern, "/ok");
  });
});

// --- selectGroup -----------------------------------------------------------

describe("selectGroup — agent selection", () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /wildcard

User-agent: Googlebot
Disallow: /google

User-agent: Googlebot-News
Disallow: /googlenews
`);

  it("picks the exact-match group first", () => {
    const group = selectGroup(robots, "Googlebot");
    assert.ok(group);
    assert.deepEqual(group.userAgents, ["googlebot"]);
  });

  it("is case-insensitive on the input agent", () => {
    const group = selectGroup(robots, "GOOGLEBOT");
    assert.ok(group);
    assert.deepEqual(group.userAgents, ["googlebot"]);
  });

  it("picks the longest-prefix group when no exact match", () => {
    // Googlebot-News-Images isn't listed; Googlebot-News is the
    // longest matching prefix.
    const group = selectGroup(robots, "Googlebot-News-Images");
    assert.ok(group);
    assert.deepEqual(group.userAgents, ["googlebot-news"]);
  });

  it("falls back to `*` when no prefix matches", () => {
    const group = selectGroup(robots, "MyBot/1.0");
    assert.ok(group);
    assert.deepEqual(group.userAgents, ["*"]);
  });

  it("returns null when robots has no groups at all", () => {
    assert.equal(selectGroup(parseRobots(""), "anyone"), null);
  });

  it("returns null when no group matches and no `*` exists", () => {
    const onlySpecific = parseRobots(`
User-agent: Googlebot
Disallow: /
`);
    assert.equal(selectGroup(onlySpecific, "MyBot"), null);
  });

  it("merges rules from multiple exact-match groups with the same agent", () => {
    // Two independent `User-agent: Googlebot` groups exist. Under
    // REP, both apply to the same agent; merging them means the
    // disallow in the second group is honoured even though the
    // first group appears first in the file.
    const duplicateGroupsRobots = parseRobots(`
User-agent: Googlebot
Allow: /public

User-agent: Googlebot
Disallow: /private
`);
    const merged = selectGroup(duplicateGroupsRobots, "Googlebot");
    assert.ok(merged);
    const kinds = merged.rules.map((rule) => ({
      kind: rule.kind,
      pattern: rule.pattern,
    }));
    assert.deepEqual(kinds, [
      { kind: "allow", pattern: "/public" },
      { kind: "disallow", pattern: "/private" },
    ]);
  });

  it("disallow in a second duplicate group wins over earlier allow (regression)", () => {
    // The scoring inside isAllowedByRobots takes the longer-prefix
    // rule; merging preserves both so the /private disallow beats
    // the /public allow for /private/... paths.
    const duplicateGroupsRobots = parseRobots(`
User-agent: Googlebot
Allow: /

User-agent: Googlebot
Disallow: /private
`);
    assert.equal(isAllowedByRobots(duplicateGroupsRobots, "Googlebot", "/private/page"), false);
    assert.equal(isAllowedByRobots(duplicateGroupsRobots, "Googlebot", "/public"), true);
  });
});

// --- isAllowedByRobots -----------------------------------------------------

describe("isAllowedByRobots — rule evaluation", () => {
  it("defaults to allowed when robots is empty", () => {
    const robots = parseRobots("");
    assert.equal(isAllowedByRobots(robots, "MyBot", "/anything"), true);
  });

  it("blocks a plain prefix Disallow", () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /private
`);
    assert.equal(isAllowedByRobots(robots, "MyBot", "/private/a"), false);
    assert.equal(isAllowedByRobots(robots, "MyBot", "/public"), true);
  });

  it("allows when Allow and Disallow tie", () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /foo
Allow: /foo
`);
    // Tie goes to Allow, matching the IETF draft's resolution.
    assert.equal(isAllowedByRobots(robots, "MyBot", "/foo/bar"), true);
  });

  it("picks longer-prefix rule on conflict", () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /foo
Allow: /foo/public
`);
    assert.equal(isAllowedByRobots(robots, "MyBot", "/foo/private"), false);
    assert.equal(isAllowedByRobots(robots, "MyBot", "/foo/public/x"), true);
  });

  it("treats an empty `Disallow:` as allow-all", () => {
    const robots = parseRobots(`
User-agent: *
Disallow:
`);
    // Per spec: `Disallow:` with empty value means nothing is
    // disallowed. Our parser normalizes this and the evaluator
    // must still allow everything.
    assert.equal(isAllowedByRobots(robots, "MyBot", "/anything"), true);
  });

  it("blocks everything on `Disallow: /`", () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /
`);
    assert.equal(isAllowedByRobots(robots, "MyBot", "/a"), false);
    assert.equal(isAllowedByRobots(robots, "MyBot", "/"), false);
  });

  it("applies the group selected by longest-prefix agent", () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /star

User-agent: Special
Disallow: /special
`);
    // Special bot sees its own group's rules, not the `*`
    // rules — robots.txt semantics don't union groups.
    assert.equal(isAllowedByRobots(robots, "Special", "/star"), true);
    assert.equal(isAllowedByRobots(robots, "Special", "/special"), false);
    // Other bots fall back to `*`.
    assert.equal(isAllowedByRobots(robots, "Other", "/star"), false);
    assert.equal(isAllowedByRobots(robots, "Other", "/special"), true);
  });
});

// --- matchesPattern (wildcards) --------------------------------------------

describe("matchesPattern — wildcards + anchors", () => {
  it("treats `*` as any-char-sequence", () => {
    assert.notEqual(matchesPattern("/a/*/c", "/a/b/c"), -1);
    assert.notEqual(matchesPattern("/a/*/c", "/a/bbb/c"), -1);
    assert.notEqual(matchesPattern("/*.php", "/foo/bar.php"), -1);
  });

  it("treats end-anchor `$` as exact-end match", () => {
    assert.notEqual(matchesPattern("/foo$", "/foo"), -1);
    assert.equal(matchesPattern("/foo$", "/foo/"), -1);
    assert.equal(matchesPattern("/foo$", "/foo/bar"), -1);
    assert.notEqual(matchesPattern("/foo.php$", "/foo.php"), -1);
    assert.equal(matchesPattern("/foo.php$", "/foo.php?q=1"), -1);
  });

  it("escapes regex metacharacters in literal portions", () => {
    // `.` in the pattern must match literal dot, not any char.
    assert.notEqual(matchesPattern("/foo.bar", "/foo.bar"), -1);
    assert.equal(matchesPattern("/foo.bar", "/fooXbar"), -1);
  });

  it("returns -1 for an empty pattern (Disallow: allow-all)", () => {
    assert.equal(matchesPattern("", "/anything"), -1);
  });

  it("ranks longer patterns higher", () => {
    const short = matchesPattern("/a", "/a/b/c");
    const long = matchesPattern("/a/b", "/a/b/c");
    assert.ok(short > 0);
    assert.ok(long > short);
  });
});

describe("isAllowedByRobots — wildcards + anchors", () => {
  it("handles wildcard Disallow", () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /*.pdf$
`);
    assert.equal(isAllowedByRobots(robots, "B", "/report.pdf"), false);
    assert.equal(isAllowedByRobots(robots, "B", "/report.html"), true);
    // Query string → doesn't end in .pdf, allowed.
    assert.equal(isAllowedByRobots(robots, "B", "/report.pdf?v=1"), true);
  });

  it("blocks tracker-style paths with wildcard Allow", () => {
    // Classic pattern: block everything under /api/, but allow
    // public subtrees.
    const robots = parseRobots(`
User-agent: *
Disallow: /api/
Allow: /api/public/
`);
    assert.equal(isAllowedByRobots(robots, "B", "/api/private"), false);
    assert.equal(isAllowedByRobots(robots, "B", "/api/public/x"), true);
  });
});
