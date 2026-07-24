// The MCP bridge maps active tool names to their ToolDef via `ALL_TOOLS[name]`.
// A bare index on a name that collides with an Object.prototype member
// (`constructor`, `toString`) reads an inherited function that survives
// `filter(Boolean)` and rides into `tools/list` as a bogus tool whose `.name`
// reads "Object". These tests pin the own-property guard in the extracted
// pure helper.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveActiveTools } from "../../server/agent/resolveActiveTools.js";

interface Tool {
  name: string;
}

const all: Record<string, Tool> = { alpha: { name: "alpha" }, beta: { name: "beta" } };

describe("resolveActiveTools", () => {
  it("resolves registered names in order and drops names not present", () => {
    assert.deepEqual(resolveActiveTools(["beta", "missing", "alpha"], all), [{ name: "beta" }, { name: "alpha" }]);
  });

  it("drops prototype-chain names instead of resolving an inherited function", () => {
    assert.deepEqual(resolveActiveTools(["constructor", "toString", "__proto__", "hasOwnProperty"], all), []);
  });

  it("keeps real tools even when a prototype-chain name is interleaved", () => {
    assert.deepEqual(resolveActiveTools(["alpha", "constructor", "beta"], all), [{ name: "alpha" }, { name: "beta" }]);
  });
});
