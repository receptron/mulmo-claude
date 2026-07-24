import "../../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests

// The gate that keeps an undeclared param from riding a mutate action's `set`
// semantics. It runs on request-body keys, and its whole job is to say no —
// so the interesting cases are the ones where saying yes is silent: the
// request succeeds, a stray value lands in the record, and nothing logs.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { firstMutateParamProblem } from "@mulmoclaude/core/collection/server";
import type { CollectionMutateAction } from "../../../server/workspace/collections/types.js";

const action = (params?: Record<string, unknown>): CollectionMutateAction =>
  ({ id: "mark-paid", kind: "mutate", label: "Mark paid", set: { status: "paid" }, ...(params ? { params } : {}) }) as unknown as CollectionMutateAction;

const withWho = action({ who: { type: "string", label: "Who" } });

describe("firstMutateParamProblem", () => {
  it("accepts no params at all", () => {
    assert.equal(firstMutateParamProblem(action(), {}), null);
  });

  it("accepts a declared param with a valid value", () => {
    assert.equal(firstMutateParamProblem(withWho, { who: "alice" }), null);
  });

  it("rejects a param the action never declared", () => {
    const problem = firstMutateParamProblem(withWho, { nope: "x" });
    assert.ok(problem?.includes("unknown param 'nope'"), `expected an unknown-param message, got: ${String(problem)}`);
  });

  it("rejects any param when the action declares none", () => {
    assert.ok(firstMutateParamProblem(action(), { who: "alice" }));
  });

  // A bare `declared[key]` resolves these to `Object.prototype` members, which
  // are not undefined — so the rejection this loop exists for never fires and
  // the stray key rides the `set` semantics silently (#2320).
  it("rejects params named after Object.prototype members", () => {
    for (const key of ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf"]) {
      const problem = firstMutateParamProblem(withWho, { [key]: "x" });
      assert.ok(problem?.includes(`unknown param '${key}'`), `expected ${key} to be rejected, got: ${String(problem)}`);
    }
  });

  // `__proto__` in an object literal sets the prototype rather than creating a
  // key, so it is absent from `Object.keys` and there is nothing to reject —
  // the loop simply never sees it. Pinned so the difference from the case
  // above is on record rather than rediscovered.
  it("sees no key at all for a literal __proto__", () => {
    assert.equal(firstMutateParamProblem(withWho, { __proto__: { who: "evil" } } as Record<string, unknown>), null);
  });

  // A JSON body, by contrast, makes `__proto__` an own data property, so it IS
  // enumerable and must be rejected like any other undeclared key.
  it("rejects a JSON-parsed __proto__ key", () => {
    const params = JSON.parse('{"__proto__": {"who": "evil"}}') as Record<string, unknown>;
    assert.ok(firstMutateParamProblem(withWho, params)?.includes("unknown param"));
  });

  // Once the keys check out, each declared param goes through the shared
  // record-field validator. Note which types that actually covers: the strict
  // tier validates number / money / boolean / date / datetime and lets every
  // other type through, so a `string` param accepts a number by design.
  it("reports a declared param's own validation problem", () => {
    const withAmount = action({ amount: { type: "number", label: "Amount" } });
    const problem = firstMutateParamProblem(withAmount, { amount: "not a number" });
    assert.ok(problem, "expected a validation problem for a non-numeric value");
    assert.equal(problem?.includes("unknown param"), false, "should be a field problem, not an unknown-key problem");
  });

  it("does not type-check a string param — the strict tier only covers numeric, boolean and date types", () => {
    assert.equal(firstMutateParamProblem(withWho, { who: 7 }), null);
  });
});
