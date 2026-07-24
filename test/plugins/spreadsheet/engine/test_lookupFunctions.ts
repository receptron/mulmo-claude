// Lookup functions driven through the whole engine. The cross-sheet VLOOKUP case
// is the #2390 regression: a sheet-qualified table array (`Data!A1:B3`) used to
// throw because one of VLOOKUP's two range parses ran a sheet-unaware regex and
// rejected the prefix before the sheet-aware parse could run. Now a single
// `parseRangeBounds` handles both (#2396).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

/** Calculate `formula` in cell A-after-the-data of a single sheet built from `rows`. */
const evalInSheet = (rows: (string | number)[][], formula: string): unknown => {
  const data = rows.map((row) => row.map((value) => ({ v: value })));
  data.push([{ v: formula }]);
  const result = new SpreadsheetEngine().calculate({ name: "S", data });
  return result.data[data.length - 1][0];
};

describe("VLOOKUP — same sheet", () => {
  const table: (string | number)[][] = [
    ["Alice", 10],
    ["Bob", 20],
    ["Carol", 30],
  ];

  it("returns the result-column value for an exact match", () => {
    assert.equal(evalInSheet(table, '=VLOOKUP("Carol", A1:B3, 2, FALSE)'), 30);
  });

  it("returns #N/A when the value is absent", () => {
    assert.equal(evalInSheet(table, '=VLOOKUP("Zoe", A1:B3, 2, FALSE)'), "#N/A");
  });
});

describe("HLOOKUP — same sheet", () => {
  it("looks across the top row and returns the row below", () => {
    const table: (string | number)[][] = [
      ["a", "b", "c"],
      [1, 2, 3],
    ];
    assert.equal(evalInSheet(table, '=HLOOKUP("b", A1:C2, 2, FALSE)'), 2);
  });
});

describe("VLOOKUP — cross-sheet table array (#2390: no longer throws)", () => {
  it("resolves a sheet-qualified table array", () => {
    const data: SheetData = {
      name: "Data",
      data: [
        [{ v: "Alice" }, { v: 10 }],
        [{ v: "Bob" }, { v: 20 }],
        [{ v: "Carol" }, { v: 30 }],
      ],
    };
    const main: SheetData = { name: "Main", data: [[{ v: '=VLOOKUP("Bob", Data!A1:B3, 2, FALSE)' }]] };
    const [mainResult] = new SpreadsheetEngine().calculateWorkbook([main, data]);
    assert.equal(mainResult.data[0][0], 20);
  });
});

// Approximate match (#2360): the 4th argument TRUE (and omitted) must do an
// approximate match — the largest first-column/row value <= the lookup key in a
// sorted range — not fall back to exact. The literal TRUE reaches the handler as
// the string "TRUE", which the old accept-only-`true|1|"1"` check missed, so
// `VLOOKUP(4, …, TRUE)` silently returned #N/A.
describe("VLOOKUP — approximate match with TRUE (#2360)", () => {
  const sorted: (string | number)[][] = [
    [1, "a"],
    [3, "b"],
    [5, "c"],
  ];

  it("returns the largest value <= the lookup key", () => {
    assert.equal(evalInSheet(sorted, "=VLOOKUP(4, A1:B3, 2, TRUE)"), "b"); // 3 is the largest <= 4
    assert.equal(evalInSheet(sorted, "=VLOOKUP(2, A1:B3, 2, TRUE)"), "a"); // 1 is the largest <= 2
    assert.equal(evalInSheet(sorted, "=VLOOKUP(9, A1:B3, 2, TRUE)"), "c"); // past the end -> last row
  });

  it("matches an exact key on the approximate path too", () => {
    assert.equal(evalInSheet(sorted, "=VLOOKUP(3, A1:B3, 2, TRUE)"), "b");
  });

  it("treats a lowercase true the same as TRUE", () => {
    assert.equal(evalInSheet(sorted, "=VLOOKUP(4, A1:B3, 2, true)"), "b");
  });

  it("approximates when the 4th argument is omitted (default TRUE)", () => {
    assert.equal(evalInSheet(sorted, "=VLOOKUP(4, A1:B3, 2)"), "b");
  });

  it("returns #N/A when the key is below the smallest value", () => {
    assert.equal(evalInSheet(sorted, "=VLOOKUP(0, A1:B3, 2, TRUE)"), "#N/A");
  });

  it("keeps the exact FALSE path unchanged", () => {
    assert.equal(evalInSheet(sorted, "=VLOOKUP(3, A1:B3, 2, FALSE)"), "b");
    assert.equal(evalInSheet(sorted, "=VLOOKUP(4, A1:B3, 2, FALSE)"), "#N/A");
  });
});

describe("HLOOKUP — approximate match with TRUE (#2360)", () => {
  const sorted: (string | number)[][] = [
    [10, 20, 30],
    ["x", "y", "z"],
  ];

  it("returns the row-2 value under the largest column <= the lookup key", () => {
    assert.equal(evalInSheet(sorted, "=HLOOKUP(25, A1:C2, 2, TRUE)"), "y"); // 20 is the largest <= 25
    assert.equal(evalInSheet(sorted, "=HLOOKUP(30, A1:C2, 2, TRUE)"), "z");
  });

  it("returns #N/A when the key is below the smallest value", () => {
    assert.equal(evalInSheet(sorted, "=HLOOKUP(5, A1:C2, 2, TRUE)"), "#N/A");
  });
});

describe("INDEX — bounds (#2390)", () => {
  const grid: (string | number)[][] = [
    [10, 11],
    [20, 21],
    [30, 31],
  ];

  it("returns the addressed cell for an in-range position", () => {
    assert.equal(evalInSheet(grid, "=INDEX(A1:B3, 2, 2)"), 21); // B2
    assert.equal(evalInSheet(grid, "=INDEX(A1:A3, 3)"), 30); // A3
  });

  it("returns #REF! when the row is past the range (was reading A5)", () => {
    assert.equal(evalInSheet(grid, "=INDEX(A1:A3, 5)"), "#REF!");
  });

  it("returns #REF! for row 0 on a multi-row range (was reading A1 above the range)", () => {
    assert.equal(evalInSheet(grid, "=INDEX(A2:B3, 0, 1)"), "#REF!");
  });
});
