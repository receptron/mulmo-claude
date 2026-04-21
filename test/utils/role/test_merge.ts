import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeRoles } from "../../../src/utils/role/merge.js";
import type { Role } from "../../../src/config/roles";

function role(id: string, name = id): Role {
  return {
    id,
    name,
    icon: "star",
    prompt: "",
    availablePlugins: [],
  };
}

describe("mergeRoles", () => {
  it("returns built-in roles unchanged when there are no custom roles", () => {
    const out = mergeRoles([role("a"), role("b")], []);
    assert.deepEqual(
      out.map((r) => r.id),
      ["a", "b"],
    );
  });

  it("appends custom roles after the built-ins", () => {
    const out = mergeRoles([role("a"), role("b")], [role("c"), role("d")]);
    assert.deepEqual(
      out.map((r) => r.id),
      ["a", "b", "c", "d"],
    );
  });

  it("custom roles override built-ins with the same id", () => {
    const out = mergeRoles([role("a", "Built-in A"), role("b", "Built-in B")], [role("a", "Custom A")]);
    assert.equal(out.length, 2);
    // The built-in 'a' is dropped, the custom 'a' is appended at the end
    assert.equal(out[0].id, "b");
    assert.equal(out[0].name, "Built-in B");
    assert.equal(out[1].id, "a");
    assert.equal(out[1].name, "Custom A");
  });

  it("returns custom only when built-ins are empty", () => {
    const out = mergeRoles([], [role("only")]);
    assert.deepEqual(
      out.map((r) => r.id),
      ["only"],
    );
  });

  it("returns empty when both inputs are empty", () => {
    assert.deepEqual(mergeRoles([], []), []);
  });

  it("preserves the order of built-in roles that are not overridden", () => {
    const out = mergeRoles([role("a"), role("b"), role("c"), role("d")], [role("c", "Custom C")]);
    assert.deepEqual(
      out.map((r) => r.id),
      ["a", "b", "d", "c"],
    );
  });
});
