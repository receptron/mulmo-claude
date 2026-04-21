import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyCellHighlights,
  clearCellHighlights,
  highlightCell,
  type HighlightableContainer,
  type HighlightableElement,
  type HighlightableTable,
} from "../../../src/plugins/spreadsheet/cellHighlights.js";

// Minimal mock DOM: each "element" tracks the classes added/removed
// on it, so the test can assert the helper manipulated the right
// node without pulling in jsdom.
function makeCell(): HighlightableElement & { classes: Set<string> } {
  const classes = new Set<string>();
  return {
    classes,
    classList: {
      add: (cls: string) => {
        classes.add(cls);
      },
      remove: (cls: string) => {
        classes.delete(cls);
      },
    },
  };
}

function makeRow(cellCount: number): {
  cells: ReturnType<typeof makeCell>[];
  row: { querySelectorAll: (_: string) => ArrayLike<HighlightableElement> };
} {
  const cells = Array.from({ length: cellCount }, () => makeCell());
  return {
    cells,
    row: { querySelectorAll: () => cells },
  };
}

function makeTable(rowsAndCols: number[][]): {
  rows: ReturnType<typeof makeRow>[];
  table: HighlightableTable;
} {
  const rows = rowsAndCols.map((cols) => makeRow(cols.length));
  return {
    rows,
    table: { querySelectorAll: () => rows.map((rowItem) => rowItem.row) },
  };
}

// Build a HighlightableContainer with the given querySelector /
// querySelectorAll responses. Arrays are already iterable so we can
// return them directly.
function makeContainer(opts: {
  onQuerySelector?: (sel: string) => HighlightableElement | HighlightableTable | null;
  onQueryAll?: (sel: string) => HighlightableElement[];
}): HighlightableContainer {
  // The `querySelector` overloaded signature can't be satisfied by
  // a single closure, so we cast the callable to the interface
  // slot — the test itself validates runtime behaviour.
  const queryFn = opts.onQuerySelector ?? (() => null);
  return {
    querySelector: queryFn as HighlightableContainer["querySelector"],
    querySelectorAll: (sel) => opts.onQueryAll?.(sel) ?? [],
  };
}

describe("highlightCell", () => {
  it("adds className to the correct cell", () => {
    const { table, rows } = makeTable([[1, 2, 3]]);
    highlightCell(table, { row: 0, col: 1 }, "cell-editing");
    assert.ok(rows[0].cells[1].classes.has("cell-editing"));
    assert.ok(!rows[0].cells[0].classes.has("cell-editing"));
  });

  it("is a no-op for a null table", () => {
    highlightCell(null, { row: 0, col: 0 }, "x");
  });

  it("is a no-op when row is out of range", () => {
    const { table, rows } = makeTable([[1]]);
    highlightCell(table, { row: 5, col: 0 }, "x");
    assert.equal(rows[0].cells[0].classes.size, 0);
  });

  it("is a no-op when col is out of range", () => {
    const { table, rows } = makeTable([[1, 2]]);
    highlightCell(table, { row: 0, col: 99 }, "x");
    assert.equal(rows[0].cells[0].classes.size, 0);
    assert.equal(rows[0].cells[1].classes.size, 0);
  });
});

describe("clearCellHighlights", () => {
  it("removes both editing and referenced classes", () => {
    const editing = makeCell();
    editing.classes.add("cell-editing");
    const ref1 = makeCell();
    ref1.classes.add("cell-referenced");
    const ref2 = makeCell();
    ref2.classes.add("cell-referenced");
    const container = makeContainer({
      onQuerySelector: (sel) => (sel === ".cell-editing" ? editing : null),
      onQueryAll: (sel) => (sel === ".cell-referenced" ? [ref1, ref2] : []),
    });
    clearCellHighlights(container);
    assert.ok(!editing.classes.has("cell-editing"));
    assert.ok(!ref1.classes.has("cell-referenced"));
    assert.ok(!ref2.classes.has("cell-referenced"));
  });

  it("is a no-op when container is null", () => {
    clearCellHighlights(null);
  });

  it("is a no-op when there are no previous highlights", () => {
    const container = makeContainer({});
    clearCellHighlights(container);
  });
});

describe("applyCellHighlights", () => {
  it("adds cell-editing + cell-referenced in one pass", () => {
    const { table, rows } = makeTable([
      [1, 2, 3],
      [1, 2, 3],
    ]);
    const container = makeContainer({
      onQuerySelector: (sel) => (sel === "#spreadsheet-table" ? table : null),
    });
    applyCellHighlights(container, { row: 0, col: 1 }, [{ row: 1, col: 2 }]);
    assert.ok(rows[0].cells[1].classes.has("cell-editing"));
    assert.ok(rows[1].cells[2].classes.has("cell-referenced"));
  });

  it("no-op when container is null", () => {
    applyCellHighlights(null, { row: 0, col: 0 }, []);
  });

  it("no-op when #spreadsheet-table is missing", () => {
    const container = makeContainer({});
    applyCellHighlights(container, { row: 0, col: 0 }, []);
  });

  it("skips editing cell when null, still applies references", () => {
    const { table, rows } = makeTable([[1, 2]]);
    const container = makeContainer({
      onQuerySelector: () => table,
    });
    applyCellHighlights(container, null, [{ row: 0, col: 1 }]);
    assert.ok(!rows[0].cells[0].classes.has("cell-editing"));
    assert.ok(rows[0].cells[1].classes.has("cell-referenced"));
  });
});
