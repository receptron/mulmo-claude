import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { availableToolsFor, toolDescriptionsFor } from "../../../src/utils/tools/mcp.js";

describe("availableToolsFor", () => {
  it("returns the role's plugins unchanged when nothing is disabled", () => {
    const out = availableToolsFor(["a", "b", "c"], new Set());
    assert.deepEqual(out, ["a", "b", "c"]);
  });

  it("filters out disabled tools", () => {
    const out = availableToolsFor(["a", "b", "c"], new Set(["b"]));
    assert.deepEqual(out, ["a", "c"]);
  });

  it("preserves order", () => {
    const out = availableToolsFor(["first", "second", "third", "fourth"], new Set(["second"]));
    assert.deepEqual(out, ["first", "third", "fourth"]);
  });

  it("returns empty when every tool is disabled", () => {
    const out = availableToolsFor(["a", "b"], new Set(["a", "b"]));
    assert.deepEqual(out, []);
  });

  it("returns empty when the role has no plugins", () => {
    const out = availableToolsFor([], new Set(["x"]));
    assert.deepEqual(out, []);
  });
});

describe("toolDescriptionsFor", () => {
  const localDefs: Record<string, { description?: string }> = {
    todo: { description: "Local todo description" },
    blank: { description: undefined },
  };
  const getDef = (name: string) => localDefs[name] ?? null;

  it("uses the local definition's description when present", () => {
    const out = toolDescriptionsFor(["todo"], getDef, {});
    assert.deepEqual(out, { todo: "Local todo description" });
  });

  it("falls back to the MCP description when the local one is undefined", () => {
    const out = toolDescriptionsFor(["blank"], getDef, {
      blank: "From MCP",
    });
    assert.deepEqual(out, { blank: "From MCP" });
  });

  it("falls back to the MCP description when there is no local def", () => {
    const out = toolDescriptionsFor(["unknown"], getDef, {
      unknown: "MCP only",
    });
    assert.deepEqual(out, { unknown: "MCP only" });
  });

  it("omits tools that have no description anywhere", () => {
    const out = toolDescriptionsFor(["unknown"], getDef, {});
    assert.deepEqual(out, {});
  });

  it("merges multiple plugins from both sources", () => {
    const out = toolDescriptionsFor(["todo", "remote"], getDef, {
      remote: "Remote MCP",
    });
    assert.deepEqual(out, {
      todo: "Local todo description",
      remote: "Remote MCP",
    });
  });
});
