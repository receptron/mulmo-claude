// Unit tests for the pure list-table sort value extractors
// (packages/core/src/collection/core/sortValueOf.ts). These map a field type
// + row to a comparable SortValue; the readers that need the rendering
// composable (toggle / flag / derived / ref display) are injected, so the
// dispatch is testable with fakes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  scalarSortValue,
  derivedSortValue,
  sortValueOf,
  type SortValueDeps,
  type CollectionItem,
  type CollectionFieldSpec as FieldSpec,
} from "@mulmoclaude/core/collection";

const numberField: FieldSpec = { type: "number", label: "N" };
const moneyField: FieldSpec = { type: "money", label: "M" };
const dateField: FieldSpec = { type: "date", label: "D" };
const datetimeField: FieldSpec = { type: "datetime", label: "DT" };
const boolField: FieldSpec = { type: "boolean", label: "B" };
const stringField: FieldSpec = { type: "string", label: "S" };
const enumField: FieldSpec = { type: "enum", label: "E", values: ["low", "high", "critical"] };
const refField: FieldSpec = { type: "ref", label: "R", to: "clients" };
const toggleField: FieldSpec = { type: "toggle", label: "T", field: "status", onValue: "done", offValue: "todo" };
const flagField: FieldSpec = { type: "flag", label: "F", where: [{ field: "n", op: "eq", value: "5" }] };
const derivedNumberField: FieldSpec = { type: "derived", label: "DN", formula: "x", display: "number" };
const derivedDateField: FieldSpec = { type: "derived", label: "DD", formula: "x", display: "date" };
const derivedStringField: FieldSpec = { type: "derived", label: "DS", formula: "x", display: "string" };
const derivedBareField: FieldSpec = { type: "derived", label: "DB", formula: "x" };

const failRef = (): string => {
  throw new Error("resolveRefDisplay should not be called");
};

function makeDeps(overrides: Partial<SortValueDeps> = {}): SortValueDeps {
  return {
    toggleChecked: () => false,
    flagValueOf: () => false,
    evaluateDerived: () => 0,
    deriveRecord: (item) => item,
    resolveRefDisplay: (targetSlug, itemSlug) => `${targetSlug}:${itemSlug}`,
    ...overrides,
  };
}

describe("scalarSortValue", () => {
  it("maps number and money to a numeric value", () => {
    assert.deepEqual(scalarSortValue(numberField, 3, failRef), { empty: false, num: 3 });
    assert.deepEqual(scalarSortValue(moneyField, "4.5", failRef), { empty: false, num: 4.5 });
  });

  it("maps date and datetime to an epoch value", () => {
    const jan = scalarSortValue(dateField, "2024-01-01", failRef);
    const jun = scalarSortValue(datetimeField, "2024-06-01T09:00:00Z", failRef);
    assert.equal(jan.empty, false);
    assert.equal(jun.empty, false);
    assert.ok(jan.num !== undefined && jun.num !== undefined && jan.num < jun.num);
  });

  it("maps enum to its declared index, not the label", () => {
    assert.deepEqual(scalarSortValue(enumField, "low", failRef), { empty: false, num: 0 });
    assert.deepEqual(scalarSortValue(enumField, "critical", failRef), { empty: false, num: 2 });
    assert.equal(scalarSortValue(enumField, "unknown", failRef).empty, true);
  });

  it("maps boolean with strict === true semantics", () => {
    assert.deepEqual(scalarSortValue(boolField, true, failRef), { empty: false, num: 1 });
    assert.deepEqual(scalarSortValue(boolField, false, failRef), { empty: false, num: 0 });
    // Only the boolean literal true counts as on — a truthy string does not.
    assert.deepEqual(scalarSortValue(boolField, "true", failRef), { empty: false, num: 0 });
  });

  it("maps a populated ref through the injected display resolver", () => {
    assert.deepEqual(
      scalarSortValue(refField, "client-1", (targetSlug, itemSlug) => `${targetSlug}/${itemSlug}`),
      { empty: false, str: "clients/client-1" },
    );
  });

  it("skips the ref resolver for an empty / non-string ref value (sorts the raw)", () => {
    assert.equal(scalarSortValue(refField, "", failRef).empty, true);
    assert.equal(scalarSortValue(refField, null, failRef).empty, true);
  });

  it("falls back to a string value for text-like fields and empties", () => {
    assert.deepEqual(scalarSortValue(stringField, "hi", failRef), { empty: false, str: "hi" });
    assert.equal(scalarSortValue(stringField, "   ", failRef).empty, true);
    assert.equal(scalarSortValue(stringField, null, failRef).empty, true);
  });
});

describe("derivedSortValue", () => {
  it("uses the numeric evaluator for the default / number / money display", () => {
    const deps = makeDeps({ evaluateDerived: () => 42 });
    assert.deepEqual(derivedSortValue(derivedBareField, "k", {}, deps), { empty: false, num: 42 });
    assert.deepEqual(derivedSortValue(derivedNumberField, "k", {}, deps), { empty: false, num: 42 });
  });

  it("flags an unevaluable derived cell (null) as empty", () => {
    const deps = makeDeps({ evaluateDerived: () => null });
    assert.equal(derivedSortValue(derivedNumberField, "k", {}, deps).empty, true);
  });

  it("reads the enriched record for a date display", () => {
    const deps = makeDeps({ deriveRecord: () => ({ k: "2024-03-01" }) });
    assert.equal(derivedSortValue(derivedDateField, "k", {}, deps).empty, false);
  });

  it("reads the enriched record as a string for any other display", () => {
    const deps = makeDeps({ deriveRecord: () => ({ k: "zeta" }) });
    assert.deepEqual(derivedSortValue(derivedStringField, "k", {}, deps), { empty: false, str: "zeta" });
  });
});

describe("sortValueOf dispatch", () => {
  it("routes toggle through toggleChecked", () => {
    let called = false;
    const deps = makeDeps({
      toggleChecked: () => {
        called = true;
        return true;
      },
    });
    assert.deepEqual(sortValueOf(toggleField, "status", { status: "done" }, deps), { empty: false, num: 1 });
    assert.equal(called, true);
  });

  it("routes flag through flagValueOf", () => {
    let called = false;
    const deps = makeDeps({
      flagValueOf: () => {
        called = true;
        return false;
      },
    });
    assert.deepEqual(sortValueOf(flagField, "n", { n: 5 }, deps), { empty: false, num: 0 });
    assert.equal(called, true);
  });

  it("routes derived through the evaluator", () => {
    const deps = makeDeps({ evaluateDerived: () => 7 });
    assert.deepEqual(sortValueOf(derivedNumberField, "k", {}, deps), { empty: false, num: 7 });
  });

  it("routes every other type through the raw scalar value", () => {
    const item: CollectionItem = { n: 12 };
    assert.deepEqual(sortValueOf(numberField, "n", item, makeDeps()), { empty: false, num: 12 });
  });
});
