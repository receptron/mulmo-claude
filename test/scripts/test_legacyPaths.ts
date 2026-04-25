import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rewriteLegacyPaths, hasLegacyPaths } from "../../scripts/lib/legacyPaths.js";

describe("rewriteLegacyPaths — happy paths", () => {
  it("rewrites a quoted markdowns reference inside a JSON string", () => {
    const input = `{"filePath":"markdowns/abc123.md"}`;
    const { text, occurrences } = rewriteLegacyPaths(input);
    assert.equal(text, `{"filePath":"artifacts/documents/abc123.md"}`);
    assert.equal(occurrences, 1);
  });

  it("rewrites a Markdown link target in parentheses", () => {
    const input = `See [doc](markdowns/notes.md) for details.`;
    const { text } = rewriteLegacyPaths(input);
    assert.equal(text, `See [doc](artifacts/documents/notes.md) for details.`);
  });

  it("rewrites an inline code reference", () => {
    const input = "The file `markdowns/foo.md` is legacy.";
    const { text } = rewriteLegacyPaths(input);
    assert.equal(text, "The file `artifacts/documents/foo.md` is legacy.");
  });

  it("rewrites a spreadsheets reference similarly", () => {
    const input = `{"sheets":"spreadsheets/abc.json"}`;
    const { text, occurrences } = rewriteLegacyPaths(input);
    assert.equal(text, `{"sheets":"artifacts/spreadsheets/abc.json"}`);
    assert.equal(occurrences, 1);
  });

  it("rewrites multiple occurrences in one line", () => {
    const input = `{"a":"markdowns/x.md","b":"markdowns/y.md","c":"spreadsheets/z.json"}`;
    const { text, occurrences } = rewriteLegacyPaths(input);
    assert.equal(text, `{"a":"artifacts/documents/x.md","b":"artifacts/documents/y.md","c":"artifacts/spreadsheets/z.json"}`);
    assert.equal(occurrences, 3);
  });

  it("handles space-delimited references", () => {
    const input = "path: markdowns/x.md here";
    const { text } = rewriteLegacyPaths(input);
    assert.equal(text, "path: artifacts/documents/x.md here");
  });

  it("handles line-start references", () => {
    const input = "markdowns/x.md\nsecond line";
    const { text } = rewriteLegacyPaths(input);
    assert.equal(text, "artifacts/documents/x.md\nsecond line");
  });
});

describe("rewriteLegacyPaths — idempotency", () => {
  it("is a no-op on already-canonical paths", () => {
    const input = `{"filePath":"artifacts/documents/abc.md","sheets":"artifacts/spreadsheets/x.json"}`;
    const { text, occurrences } = rewriteLegacyPaths(input);
    assert.equal(text, input);
    assert.equal(occurrences, 0);
  });

  it("is idempotent (second rewrite of first-rewrite output = same output)", () => {
    const input = `{"filePath":"markdowns/abc.md"}`;
    const first = rewriteLegacyPaths(input);
    const second = rewriteLegacyPaths(first.text);
    assert.equal(second.text, first.text);
    assert.equal(second.occurrences, 0);
  });
});

describe("rewriteLegacyPaths — boundary / no-match cases", () => {
  it("does NOT rewrite when prefix is continued from a word char", () => {
    const input = `{"path":"my-markdowns/foo.md"}`;
    const { text, occurrences } = rewriteLegacyPaths(input);
    assert.equal(text, input);
    assert.equal(occurrences, 0);
  });

  it("does NOT rewrite when preceded by an absolute-path slash", () => {
    const input = "Under /abs/markdowns/foo.md";
    const { text, occurrences } = rewriteLegacyPaths(input);
    assert.equal(text, input);
    assert.equal(occurrences, 0);
  });

  it("does NOT rewrite when preceded by a dot (part of an extension-like token)", () => {
    const input = "pkg.markdowns/foo.md";
    const { text, occurrences } = rewriteLegacyPaths(input);
    assert.equal(text, input);
    assert.equal(occurrences, 0);
  });

  it("does NOT rewrite `markdowns/` without a filename", () => {
    const input = `The "markdowns/" directory was renamed.`;
    const { text, occurrences } = rewriteLegacyPaths(input);
    assert.equal(text, input);
    assert.equal(occurrences, 0);
  });

  it("does NOT rewrite markdowns/ with wrong extension", () => {
    const input = `path: markdowns/foo.txt here`;
    const { text, occurrences } = rewriteLegacyPaths(input);
    assert.equal(text, input);
    assert.equal(occurrences, 0);
  });

  it("does NOT rewrite spreadsheets/ without .json extension", () => {
    const input = `path: spreadsheets/foo.csv here`;
    const { text, occurrences } = rewriteLegacyPaths(input);
    assert.equal(text, input);
    assert.equal(occurrences, 0);
  });

  it("leaves unrelated prose mentions alone", () => {
    const input = "The old markdowns directory and spreadsheets directory were merged.";
    const { text, occurrences } = rewriteLegacyPaths(input);
    assert.equal(text, input);
    assert.equal(occurrences, 0);
  });
});

describe("rewriteLegacyPaths — real-world shortId refs", () => {
  it("handles 16-hex shortId filenames from production workspaces", () => {
    const input = `{"markdown":"markdowns/40d085a3864a424f.md"}`;
    const { text } = rewriteLegacyPaths(input);
    assert.equal(text, `{"markdown":"artifacts/documents/40d085a3864a424f.md"}`);
  });

  it("handles legacy names with underscores and hyphens", () => {
    const input = `(markdowns/my-doc_v2.md)`;
    const { text } = rewriteLegacyPaths(input);
    assert.equal(text, `(artifacts/documents/my-doc_v2.md)`);
  });
});

describe("hasLegacyPaths", () => {
  it("returns true when any legacy reference exists", () => {
    assert.equal(hasLegacyPaths(`{"x":"markdowns/a.md"}`), true);
    assert.equal(hasLegacyPaths(`{"x":"spreadsheets/a.json"}`), true);
  });

  it("returns false when none exist", () => {
    assert.equal(hasLegacyPaths(`{"x":"artifacts/documents/a.md"}`), false);
    assert.equal(hasLegacyPaths("just some text"), false);
    assert.equal(hasLegacyPaths(""), false);
  });

  it("is not confused by adjacent word boundaries", () => {
    assert.equal(hasLegacyPaths("my-markdowns/foo.md"), false);
  });
});
