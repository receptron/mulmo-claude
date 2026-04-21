import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findCellJsonPosition } from "../../../../src/plugins/spreadsheet/engine/jsonCellLocator.js";

describe("findCellJsonPosition", () => {
  const sample = JSON.stringify(
    [
      {
        name: "Sheet1",
        data: [
          [{ v: "A1" }, { v: "B1" }, { v: 42 }],
          [{ v: "A2" }, { v: "B2" }, { v: "=SUM(A1:B1)" }],
        ],
      },
      {
        name: "Sheet2",
        data: [[{ v: "X" }, { v: "Y" }]],
      },
    ],
    null,
    2,
  );

  // The locator returns the character offset of the cell's opening
  // `{`. In a pretty-printed document, following lines expand the
  // object so we only assert the starting char and that the
  // substring contains the unique cell value.
  function assertCellAt(pos: number, expectedSubstring: string) {
    assert.ok(pos > 0, `expected a positive offset, got ${pos}`);
    assert.equal(sample[pos], "{", `expected offset to land on '{', got '${sample[pos]}'`);
    assert.ok(sample.substring(pos).includes(expectedSubstring), `expected substring ${JSON.stringify(expectedSubstring)} after position ${pos}`);
  }

  it("locates cell (0,0) in the first sheet", () => {
    assertCellAt(findCellJsonPosition(sample, "Sheet1", 0, 0), `"v": "A1"`);
  });

  it("locates cell (0,2) — the last column in row 0", () => {
    assertCellAt(findCellJsonPosition(sample, "Sheet1", 0, 2), `"v": 42`);
  });

  it("locates cell (1,2) with a formula value", () => {
    assertCellAt(findCellJsonPosition(sample, "Sheet1", 1, 2), `"v": "=SUM(A1:B1)"`);
  });

  it("locates cell in a non-first sheet by name", () => {
    assertCellAt(findCellJsonPosition(sample, "Sheet2", 0, 1), `"v": "Y"`);
  });

  it("returns -1 for a sheet name that does not exist", () => {
    assert.equal(findCellJsonPosition(sample, "Unknown", 0, 0), -1);
  });

  it("returns -1 for a row index past the end", () => {
    assert.equal(findCellJsonPosition(sample, "Sheet1", 99, 0), -1);
  });

  it("returns -1 on completely empty input", () => {
    assert.equal(findCellJsonPosition("", "Sheet1", 0, 0), -1);
  });

  it("handles strings containing brackets and commas without miscounting", () => {
    const tricky = JSON.stringify(
      [
        {
          name: "Sheet1",
          data: [[{ v: "has [bracket], and comma" }, { v: "second" }]],
        },
      ],
      null,
      2,
    );
    const pos = findCellJsonPosition(tricky, "Sheet1", 0, 1);
    assert.ok(pos > 0);
    assert.equal(tricky[pos], "{");
    assert.ok(tricky.substring(pos).includes(`"v": "second"`));
  });

  it("picks the correct row when an earlier row contains '[' inside a string", () => {
    // Row 0 cell 0 contains a literal '[' — the naive counter would
    // treat that as an extra row opener and shift all subsequent
    // rowIndex lookups by one.
    const withBracketInRow0 = JSON.stringify(
      [
        {
          name: "Sheet1",
          data: [
            [{ v: "row0 has [bracket]" }, { v: "r0c1" }],
            [{ v: "r1c0" }, { v: "TARGET" }],
          ],
        },
      ],
      null,
      2,
    );
    const pos = findCellJsonPosition(withBracketInRow0, "Sheet1", 1, 1);
    assert.ok(pos > 0);
    assert.ok(withBracketInRow0.substring(pos).includes(`"v": "TARGET"`));
  });

  it("finds a sheet whose name contains a quote character", () => {
    // Sheet names with embedded `"` need JSON-escaping when building
    // the text marker, otherwise indexOf misses them entirely.
    const text = JSON.stringify(
      [
        {
          name: 'Sheet "Q1"',
          data: [[{ v: "FOUND" }]],
        },
      ],
      null,
      2,
    );
    const pos = findCellJsonPosition(text, 'Sheet "Q1"', 0, 0);
    assert.ok(pos > 0, `expected to locate the sheet, got ${pos}`);
    assert.ok(text.substring(pos).includes(`"v": "FOUND"`));
  });
});
