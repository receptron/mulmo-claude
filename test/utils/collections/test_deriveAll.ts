// Unit tests for the shared derived-field saturation loop
// (src/utils/collections/deriveAll.ts) — the one implementation the
// client rendering layer AND the server's manageCollection enrichment
// both call, so its convergence/cycle/ref semantics are pinned here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveAll, resolveRowRefs, type DerivableSchema } from "@mulmoclaude/core/collection";

const field = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });

describe("deriveAll — saturation across chained derived fields", () => {
  // total reads tax reads subtotal: declaration order is reversed on
  // purpose so convergence REQUIRES multiple passes.
  const schema: DerivableSchema = {
    fields: {
      total: field("derived", { formula: "subtotal + tax" }),
      tax: field("derived", { formula: "subtotal * taxRate" }),
      subtotal: field("derived", { formula: "sum(lineItems[].quantity * lineItems[].rate)" }),
      taxRate: field("number"),
      lineItems: field("table"),
    },
  };

  it("converges within field-count passes regardless of declaration order", () => {
    const enriched = deriveAll(
      schema,
      {
        taxRate: 0.1,
        lineItems: [
          { quantity: 10, rate: 100 },
          { quantity: 2, rate: 250 },
        ],
      },
      {},
    );
    assert.equal(enriched.subtotal, 1500);
    assert.equal(enriched.tax, 150);
    assert.equal(enriched.total, 1650);
  });

  it("does not mutate the base record", () => {
    const base = { taxRate: 0.1, lineItems: [{ quantity: 1, rate: 100 }] };
    deriveAll(schema, base, {});
    assert.deepEqual(base, { taxRate: 0.1, lineItems: [{ quantity: 1, rate: 100 }] });
  });

  it("leaves a failed formula absent instead of poisoning siblings", () => {
    // No taxRate: `tax` (and so `total`) can never evaluate, but
    // `subtotal` still does — a failure stays local to its field.
    const enriched = deriveAll(schema, { lineItems: [{ quantity: 1, rate: 100 }] }, {});
    assert.equal(enriched.subtotal, 100);
    assert.equal(enriched.tax, undefined);
    assert.equal(enriched.total, undefined);
  });
});

describe("deriveAll — persisted derived values are never trusted", () => {
  const schema: DerivableSchema = {
    fields: {
      ticker: field("ref", { to: "stock-quotes" }),
      shares: field("number"),
      value: field("derived", { formula: "shares * ticker.price" }),
    },
  };

  it("a stale stored value is stripped when the formula fails (dangling ref)", () => {
    // The record carries value: 999 (raw Write / legacy data); the
    // formula can't evaluate. The stale value must NOT survive as if
    // host-computed.
    const enriched = deriveAll(schema, { ticker: "ghost", shares: 10, value: 999 }, {});
    assert.equal(enriched.value, undefined);
  });

  it("a stale stored value is replaced when the formula succeeds", () => {
    const refRecords = { "stock-quotes": { aapl: { price: 200 } } };
    const enriched = deriveAll(schema, { ticker: "aapl", shares: 10, value: 999 }, refRecords);
    assert.equal(enriched.value, 2000);
  });
});

describe("deriveAll — cycles", () => {
  it("saturates without looping on a 2-cycle", () => {
    const schema: DerivableSchema = {
      fields: {
        a: field("derived", { formula: "b + 1" }),
        b: field("derived", { formula: "a + 1" }),
      },
    };
    // Bounded passes (= derived-field count); values climb once per pass
    // then the loop exits. The exact values don't matter — termination
    // and "no throw" do.
    const enriched = deriveAll(schema, {}, {});
    assert.ok(!("a" in enriched) || typeof enriched.a === "number");
  });
});

describe("deriveAll + resolveRowRefs — cross-collection deref", () => {
  const schema: DerivableSchema = {
    fields: {
      ticker: field("ref", { to: "stock-quotes" }),
      shares: field("number"),
      value: field("derived", { formula: "shares * ticker.price" }),
    },
  };
  const refRecords = { "stock-quotes": { aapl: { symbol: "aapl", price: 200 } } };

  it("evaluates shares * ticker.price through the ref cache", () => {
    const enriched = deriveAll(schema, { ticker: "aapl", shares: 10 }, refRecords);
    assert.equal(enriched.value, 2000);
  });

  it("dangling ref slug yields no derived value", () => {
    const enriched = deriveAll(schema, { ticker: "msft", shares: 10 }, refRecords);
    assert.equal(enriched.value, undefined);
  });

  it("missing target collection yields no derived value", () => {
    const enriched = deriveAll(schema, { ticker: "aapl", shares: 10 }, {});
    assert.equal(enriched.value, undefined);
  });

  it("resolveRowRefs keys by LOCAL field name and nulls non-string slugs", () => {
    const refs = resolveRowRefs(schema, { ticker: "aapl", shares: 10 }, refRecords);
    assert.deepEqual(refs, { ticker: { symbol: "aapl", price: 200 } });
    assert.deepEqual(resolveRowRefs(schema, { ticker: 42 }, refRecords), { ticker: null });
  });

  // #2322: a dangling ref slug that is a prototype key must fall back to
  // null, not resolve to an inherited Object.prototype member (a bare
  // `byId["constructor"]` returns the Object function).
  for (const protoKey of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    it(`dangling proto-key slug "${protoKey}" resolves to null (not a prototype value)`, () => {
      assert.deepEqual(resolveRowRefs(schema, { ticker: protoKey }, refRecords), { ticker: null });
      assert.equal(deriveAll(schema, { ticker: protoKey, shares: 10 }, refRecords).value, undefined);
    });
  }

  it("a proto-key target COLLECTION is treated as unloaded (null), not the Object function", () => {
    const schemaToProto: DerivableSchema = { fields: { ticker: field("ref", { to: "constructor" }) } };
    assert.deepEqual(resolveRowRefs(schemaToProto, { ticker: "aapl" }, refRecords), { ticker: null });
  });

  it("a record whose id is literally a prototype key still resolves (own key, boundary)", () => {
    const realProtoRecords = { "stock-quotes": { constructor: { symbol: "constructor", price: 5 } } };
    assert.deepEqual(resolveRowRefs(schema, { ticker: "constructor" }, realProtoRecords), {
      ticker: { symbol: "constructor", price: 5 },
    });
  });
});

describe("deriveAll — flag fields", () => {
  it("computes a membership flag over an enum value", () => {
    const schema: DerivableSchema = {
      fields: {
        status: field("enum"),
        isDone: field("flag", { where: [{ field: "status", op: "in", value: ["done", "canceled"] }] }),
      },
    };
    assert.equal(deriveAll(schema, { status: "done" }, {}).isDone, true);
    assert.equal(deriveAll(schema, { status: "doing" }, {}).isDone, false);
  });

  it("computes a numeric-compare flag (gte)", () => {
    const schema: DerivableSchema = {
      fields: {
        score: field("number"),
        isPassed: field("flag", { where: [{ field: "score", op: "gte", value: "60" }] }),
      },
    };
    assert.equal(deriveAll(schema, { score: 75 }, {}).isPassed, true);
    assert.equal(deriveAll(schema, { score: 59 }, {}).isPassed, false);
  });

  it("a flag reads a derived value computed in an earlier pass", () => {
    // Declaration order forces saturation: the flag is declared before
    // the derived total it compares against.
    const schema: DerivableSchema = {
      fields: {
        isOverBudget: field("flag", { where: [{ field: "total", op: "gt", valueFrom: { field: "budget" } }] }),
        total: field("derived", { formula: "subtotal * 2" }),
        subtotal: field("number"),
        budget: field("number"),
      },
    };
    assert.equal(deriveAll(schema, { subtotal: 100, budget: 150 }, {}).isOverBudget, true);
    assert.equal(deriveAll(schema, { subtotal: 100, budget: 300 }, {}).isOverBudget, false);
  });

  it('a flag composes over another flag via eq "true"', () => {
    const schema: DerivableSchema = {
      fields: {
        isActive: field("flag", { where: [{ field: "isDone", op: "ne", value: "true" }] }),
        isDone: field("flag", { where: [{ field: "status", op: "in", value: ["done"] }] }),
        status: field("enum"),
      },
    };
    assert.equal(deriveAll(schema, { status: "done" }, {}).isActive, false);
    assert.equal(deriveAll(schema, { status: "todo" }, {}).isActive, true);
  });

  it("strips a stale stored flag value (host-truth, like derived)", () => {
    const schema: DerivableSchema = {
      fields: {
        status: field("enum"),
        isDone: field("flag", { where: [{ field: "status", op: "eq", value: "done" }] }),
      },
    };
    // A forged/stale `isDone: true` in the record JSON must not survive.
    assert.equal(deriveAll(schema, { status: "todo", isDone: true }, {}).isDone, false);
  });

  it("a missing predicate field reads as false for every op except ne", () => {
    const schema: DerivableSchema = {
      fields: {
        status: field("enum"),
        isDone: field("flag", { where: [{ field: "status", op: "eq", value: "done" }] }),
        isNotDone: field("flag", { where: [{ field: "status", op: "ne", value: "done" }] }),
      },
    };
    const enriched = deriveAll(schema, {}, {});
    assert.equal(enriched.isDone, false);
    assert.equal(enriched.isNotDone, true);
  });
});
