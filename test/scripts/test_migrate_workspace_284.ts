import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rewriteJsonEntry,
  rewritePathValue,
  rewriteProseText,
  DIR_MIGRATIONS,
  PATH_REWRITE_PREFIXES,
} from "../../scripts/migrate-workspace-284.js";

describe("rewritePathValue", () => {
  it("rewrites a legacy markdowns/ prefix to artifacts/documents/", () => {
    assert.equal(
      rewritePathValue("markdowns/foo.md"),
      "artifacts/documents/foo.md",
    );
  });

  it("rewrites HTMLs/ to artifacts/html/ (case-sensitive)", () => {
    assert.equal(
      rewritePathValue("HTMLs/report.html"),
      "artifacts/html/report.html",
    );
  });

  it("rewrites configs/ to config/", () => {
    assert.equal(
      rewritePathValue("configs/settings.json"),
      "config/settings.json",
    );
  });

  it("rewrites wiki/ to data/wiki/", () => {
    assert.equal(
      rewritePathValue("wiki/pages/foo.md"),
      "data/wiki/pages/foo.md",
    );
  });

  it("leaves an unrelated path alone", () => {
    assert.equal(rewritePathValue("other/foo"), "other/foo");
    assert.equal(rewritePathValue(""), "");
    assert.equal(
      rewritePathValue("https://example.com/markdowns/foo"),
      "https://example.com/markdowns/foo",
    );
  });

  it("does not double-migrate an already-migrated path", () => {
    // Running the script twice should be a no-op on the second run.
    const out = rewritePathValue("artifacts/documents/foo.md");
    assert.equal(out, "artifacts/documents/foo.md");
  });
});

describe("rewriteJsonEntry", () => {
  it("rewrites `filePath` strings", () => {
    const { value, rewrites } = rewriteJsonEntry({
      filePath: "charts/abc.chart.json",
      title: "demo",
    });
    assert.deepEqual(value, {
      filePath: "artifacts/charts/abc.chart.json",
      title: "demo",
    });
    assert.equal(rewrites, 1);
  });

  it("rewrites nested `path` strings inside data fields", () => {
    const { value, rewrites } = rewriteJsonEntry({
      data: {
        result: { path: "stories/foo.json", other: "x" },
      },
    });
    assert.deepEqual(value, {
      data: {
        result: { path: "artifacts/stories/foo.json", other: "x" },
      },
    });
    assert.equal(rewrites, 1);
  });

  it("leaves non-path strings in filePath position alone if they don't match", () => {
    const { value, rewrites } = rewriteJsonEntry({
      filePath: "other-unrelated-string",
    });
    assert.deepEqual(value, { filePath: "other-unrelated-string" });
    assert.equal(rewrites, 0);
  });

  it("leaves URL-bearing fields alone (path key only)", () => {
    const { value, rewrites } = rewriteJsonEntry({
      url: "https://example.com/wiki/page",
      src: "wiki/foo",
    });
    assert.deepEqual(value, {
      url: "https://example.com/wiki/page",
      src: "wiki/foo",
    });
    assert.equal(rewrites, 0);
  });

  it("counts rewrites across arrays and deep nesting", () => {
    const { value, rewrites } = rewriteJsonEntry({
      results: [
        { filePath: "markdowns/a.md" },
        { filePath: "HTMLs/b.html" },
        { filePath: "unrelated" },
      ],
    });
    assert.equal(rewrites, 2);
    const out = (value as { results: { filePath: string }[] }).results;
    assert.equal(out[0].filePath, "artifacts/documents/a.md");
    assert.equal(out[1].filePath, "artifacts/html/b.html");
    assert.equal(out[2].filePath, "unrelated");
  });

  it("is pure — input is not mutated", () => {
    const input = { filePath: "markdowns/a.md" };
    const before = JSON.stringify(input);
    rewriteJsonEntry(input);
    assert.equal(JSON.stringify(input), before);
  });
});

describe("rewriteProseText", () => {
  it("rewrites a word-boundary-bounded legacy prefix", () => {
    const { value, rewrites } = rewriteProseText("see wiki/foo.md for details");
    assert.equal(value, "see data/wiki/foo.md for details");
    assert.equal(rewrites, 1);
  });

  it("rewrites at the start of a line", () => {
    const { value, rewrites } = rewriteProseText("markdowns/a.md\nwiki/b.md");
    assert.equal(value, "artifacts/documents/a.md\ndata/wiki/b.md");
    assert.equal(rewrites, 2);
  });

  it("does NOT rewrite when prefix is inside a word (wikipedia is not wiki/)", () => {
    const { value, rewrites } = rewriteProseText("wikipedia.org and awiki/foo");
    // "awiki/foo" has `a` right before wiki — `a` IS alnum, so word
    // boundary fails. Not rewritten. "wikipedia" has no `/` so it
    // also fails the prefix check.
    assert.equal(value, "wikipedia.org and awiki/foo");
    assert.equal(rewrites, 0);
  });

  it("rewrites inside backticks (bullet list style)", () => {
    const input = "- `markdowns/foo.md` — the doc";
    const { value } = rewriteProseText(input);
    assert.equal(value, "- `artifacts/documents/foo.md` — the doc");
  });

  it("rewrites in a path-looking URL but only when the prefix is at a boundary", () => {
    // Not a real URL — just prose that happens to look path-like.
    const { value } = rewriteProseText("go to wiki/pages/");
    assert.equal(value, "go to data/wiki/pages/");
  });

  it("is idempotent: re-running on already-migrated prose is a no-op", () => {
    // CodeRabbit caught this: the old boundary class allowed `/` as a
    // left boundary, so `data/wiki/foo.md` → `data/data/wiki/foo.md`
    // on a second run. Multiple call sites already persist migrated
    // paths to disk, so the script MUST stay idempotent.
    const alreadyMigrated =
      "See data/wiki/foo.md and conversations/summaries/_index.md.";
    const first = rewriteProseText(alreadyMigrated);
    assert.equal(first.rewrites, 0);
    assert.equal(first.value, alreadyMigrated);
    // Second pass over the first output should also produce zero
    // rewrites — defends against the fixed bug reappearing.
    const second = rewriteProseText(first.value);
    assert.equal(second.rewrites, 0);
    assert.equal(second.value, alreadyMigrated);
  });

  it("does NOT rewrite URLs or relative paths that happen to contain a legacy prefix", () => {
    // `/` must be excluded from the left-boundary class so neither
    // `../wiki/...` nor `https://example.com/wiki/...` get mangled.
    const input =
      "Relative link: ../wiki/foo.md\nExternal: https://example.com/wiki/foo\nLeading dot: ./wiki/bar";
    const { value, rewrites } = rewriteProseText(input);
    assert.equal(rewrites, 0);
    assert.equal(value, input);
  });
});

describe("invariants", () => {
  it("every DIR_MIGRATION entry shows up in PATH_REWRITE_PREFIXES", () => {
    assert.equal(PATH_REWRITE_PREFIXES.length, DIR_MIGRATIONS.length);
    for (let i = 0; i < DIR_MIGRATIONS.length; i++) {
      const [oldP, newP] = PATH_REWRITE_PREFIXES[i];
      assert.equal(oldP, `${DIR_MIGRATIONS[i].from}/`);
      assert.equal(newP, `${DIR_MIGRATIONS[i].to}/`);
    }
  });

  it("all target paths are under one of the 4 grouping dirs", () => {
    const groupings = ["config/", "conversations/", "data/", "artifacts/"];
    for (const { to } of DIR_MIGRATIONS) {
      const under = groupings.some(
        (g) => to === g.slice(0, -1) || to.startsWith(g),
      );
      assert.ok(under, `target "${to}" does not fit any grouping`);
    }
  });

  it("no `from` is a prefix of another `from` (would cause ordering issues)", () => {
    for (const a of DIR_MIGRATIONS) {
      for (const b of DIR_MIGRATIONS) {
        if (a === b) continue;
        assert.ok(
          !b.from.startsWith(`${a.from}/`),
          `"${b.from}" is nested under "${a.from}" — migration order matters`,
        );
      }
    }
  });
});
