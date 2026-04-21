// Unit tests for server/api/routes/chart.ts. Validates the payload guard
// pure-functionally so we don't need to spin up an Express app or
// touch the filesystem. The route wires slug + timestamp onto a tmp
// file; that side is covered by the e2e spec.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isValidChartDocument } from "../../server/api/routes/chart.js";

describe("isValidChartDocument", () => {
  it("accepts a minimal one-chart document", () => {
    assert.ok(
      isValidChartDocument({
        charts: [{ option: { series: [{ type: "line", data: [1, 2] }] } }],
      }),
    );
  });

  it("accepts a multi-chart document with optional fields", () => {
    assert.ok(
      isValidChartDocument({
        title: "Apple Stock",
        charts: [
          { title: "Price", type: "line", option: { series: [] } },
          { title: "Volume", type: "bar", option: { series: [] } },
        ],
      }),
    );
  });

  it("rejects non-objects", () => {
    assert.equal(isValidChartDocument(null), false);
    assert.equal(isValidChartDocument(undefined), false);
    assert.equal(isValidChartDocument("nope"), false);
    assert.equal(isValidChartDocument(42), false);
    assert.equal(isValidChartDocument([]), false);
  });

  it("rejects missing charts field", () => {
    assert.equal(isValidChartDocument({}), false);
    assert.equal(isValidChartDocument({ title: "x" }), false);
  });

  it("rejects non-array charts", () => {
    assert.equal(isValidChartDocument({ charts: "nope" }), false);
    assert.equal(isValidChartDocument({ charts: { 0: {} } }), false);
  });

  it("rejects an empty charts array", () => {
    assert.equal(isValidChartDocument({ charts: [] }), false);
  });

  it("rejects entries without a valid option object", () => {
    assert.equal(isValidChartDocument({ charts: [{}] }), false);
    assert.equal(isValidChartDocument({ charts: [{ option: null }] }), false);
    assert.equal(isValidChartDocument({ charts: [{ option: "not-an-object" }] }), false);
    assert.equal(isValidChartDocument({ charts: [{ option: [] }] }), false, "arrays are not valid option objects");
  });

  it("rejects when any one chart in the array is malformed", () => {
    assert.equal(
      isValidChartDocument({
        charts: [{ option: { series: [] } }, { option: null }],
      }),
      false,
    );
  });

  it("rejects non-string document.title", () => {
    assert.equal(isValidChartDocument({ title: 42, charts: [{ option: {} }] }), false);
    assert.equal(isValidChartDocument({ title: null, charts: [{ option: {} }] }), false);
  });

  it("rejects non-string chart entry title or type", () => {
    assert.equal(isValidChartDocument({ charts: [{ title: 42, option: {} }] }), false);
    assert.equal(isValidChartDocument({ charts: [{ type: {}, option: {} }] }), false);
  });
});
