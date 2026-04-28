// Unit tests for the wiki-history diff helpers (#763 PR 3 / #944).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { joinFrontmatterAndBody, renderUnifiedDiff, stripAutoStampKeys } from "../../../../src/plugins/wiki/history/diff.js";

describe("renderUnifiedDiff", () => {
  it("returns an empty array when left and right are identical", () => {
    const out = renderUnifiedDiff("a\nb\nc\n", "a\nb\nc\n");
    assert.deepEqual(out, []);
  });

  it("returns a single hunk for a small inline change", () => {
    const left = "a\nb\nc\n";
    const right = "a\nB\nc\n";
    const hunks = renderUnifiedDiff(left, right, 3);
    assert.equal(hunks.length, 1);
    const kinds = hunks[0].lines.map((line) => line.kind);
    // Whole file fits inside ±3 context, so we see all three "rows":
    // del+add for the changed line, surrounded by context.
    assert.ok(kinds.includes("del"));
    assert.ok(kinds.includes("add"));
    assert.ok(kinds.includes("context"));
    assert.equal(hunks[0].hiddenBefore, 0);
    assert.equal(hunks[0].hiddenAfter, 0);
  });

  it("collapses long unchanged runs at the head and tail of the file", () => {
    const head = Array.from({ length: 20 }, (_, i) => `head${i}`).join("\n");
    const tail = Array.from({ length: 20 }, (_, i) => `tail${i}`).join("\n");
    const left = `${head}\nMIDDLE\n${tail}\n`;
    const right = `${head}\nCHANGED\n${tail}\n`;

    const hunks = renderUnifiedDiff(left, right, 3);
    assert.equal(hunks.length, 1, "single change → single hunk");
    // The hunk shows ±3 context lines around the change.
    const kinds = hunks[0].lines.map((line) => line.kind);
    assert.equal(kinds.filter((kind) => kind === "del").length, 1);
    assert.equal(kinds.filter((kind) => kind === "add").length, 1);
    assert.equal(kinds.filter((kind) => kind === "context").length, 6, "3 above + 3 below");

    // Everything outside the ±3 window is hidden.
    assert.equal(hunks[0].hiddenBefore, 17, "20 head lines minus the 3 surfaced as context");
    assert.equal(hunks[0].hiddenAfter, 17, "20 tail lines minus the 3 surfaced as context");
  });

  it("merges two nearby changes into one hunk when context windows overlap", () => {
    const lines = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const left = `${lines.join("\n")}\n`;
    const rightLines = [...lines];
    rightLines[2] = "C"; // Change line 'c'
    rightLines[6] = "G"; // Change line 'g'
    // Distance between changes = 4 lines. With contextLines=3 both
    // windows reach into each other → single merged hunk.
    const hunks = renderUnifiedDiff(left, `${rightLines.join("\n")}\n`, 3);
    assert.equal(hunks.length, 1);
    const adds = hunks[0].lines.filter((line) => line.kind === "add");
    const dels = hunks[0].lines.filter((line) => line.kind === "del");
    assert.equal(adds.length, 2);
    assert.equal(dels.length, 2);
  });

  it("splits two distant changes into separate hunks", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`);
    const left = `${lines.join("\n")}\n`;
    const rightLines = [...lines];
    rightLines[5] = "FIVE";
    rightLines[25] = "TWENTYFIVE";
    // Distance = 20 lines, well over 2*3 — windows don't overlap.
    const hunks = renderUnifiedDiff(left, `${rightLines.join("\n")}\n`, 3);
    assert.equal(hunks.length, 2);
    // Each hunk should carry one add + one del.
    for (const hunk of hunks) {
      const kinds = hunk.lines.map((line) => line.kind);
      assert.equal(kinds.filter((kind) => kind === "add").length, 1);
      assert.equal(kinds.filter((kind) => kind === "del").length, 1);
    }
    // Gap between hunks (20 - 6 unchanged from each window = 14)
    // shows up as the second hunk's `hiddenBefore`.
    assert.ok(hunks[1].hiddenBefore > 0);
  });

  it("respects a custom context size", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const left = `${lines.join("\n")}\n`;
    const rightLines = [...lines];
    rightLines[10] = "TEN";
    const hunks0 = renderUnifiedDiff(left, `${rightLines.join("\n")}\n`, 0);
    const hunks5 = renderUnifiedDiff(left, `${rightLines.join("\n")}\n`, 5);
    // 0 context = only the changed lines surface.
    assert.equal(hunks0[0].lines.filter((line) => line.kind === "context").length, 0);
    // 5 context = 5 above + 5 below.
    assert.equal(hunks5[0].lines.filter((line) => line.kind === "context").length, 10);
  });

  it("handles pure-add and pure-delete (one side is empty)", () => {
    const addOnly = renderUnifiedDiff("", "x\ny\n", 3);
    assert.equal(addOnly.length, 1);
    assert.equal(
      addOnly[0].lines.every((line) => line.kind === "add"),
      true,
    );

    const delOnly = renderUnifiedDiff("x\ny\n", "", 3);
    assert.equal(delOnly.length, 1);
    assert.equal(
      delOnly[0].lines.every((line) => line.kind === "del"),
      true,
    );
  });
});

describe("stripAutoStampKeys", () => {
  it("removes only `updated` and `editor`", () => {
    const input = {
      title: "X",
      created: "2026-04-01",
      updated: "2026-04-28T01:00:00.000Z",
      editor: "user",
      tags: ["a", "b"],
    };
    assert.deepEqual(stripAutoStampKeys(input), {
      title: "X",
      created: "2026-04-01",
      tags: ["a", "b"],
    });
  });

  it("is a no-op when neither key is present", () => {
    const input = { title: "X" };
    assert.deepEqual(stripAutoStampKeys(input), { title: "X" });
  });
});

describe("joinFrontmatterAndBody", () => {
  it("returns the body alone when the frontmatter is empty", () => {
    assert.equal(joinFrontmatterAndBody({}, "hello\n"), "hello\n");
  });

  it("emits sorted frontmatter so key reordering doesn't show as a diff", () => {
    const first = joinFrontmatterAndBody({ title: "X", created: "2026-01-01" }, "body\n");
    const second = joinFrontmatterAndBody({ created: "2026-01-01", title: "X" }, "body\n");
    assert.equal(first, second);
  });

  it("renders array values in flow style", () => {
    const out = joinFrontmatterAndBody({ tags: ["a", "b"] }, "body\n");
    assert.match(out, /^tags: \[a, b\]$/m);
  });

  it("quotes string values that contain YAML-special characters", () => {
    const out = joinFrontmatterAndBody({ title: "Hello: World" }, "body\n");
    // JSON.stringify produces a double-quoted string — it's a valid
    // YAML scalar and unambiguous.
    assert.match(out, /^title: "Hello: World"$/m);
  });

  it("a body-only diff after stripping auto-stamps is empty", () => {
    // Snapshot taken at T1 vs T2 with only `updated` differing — the
    // user actually changed nothing. The diff helpers' contract:
    // strip auto-stamps THEN compose THEN diff → no hunks.
    const left = joinFrontmatterAndBody(stripAutoStampKeys({ title: "X", updated: "T1", editor: "user" }), "body\n");
    const right = joinFrontmatterAndBody(stripAutoStampKeys({ title: "X", updated: "T2", editor: "user" }), "body\n");
    assert.deepEqual(renderUnifiedDiff(left, right, 3), []);
  });
});
