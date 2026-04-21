import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ALL_TOOL_NAMES, isToolName, TOOL_NAMES, type ToolName } from "../../src/config/toolNames.js";

describe("TOOL_NAMES", () => {
  it("value and key align (the key is the camelCase form of the literal)", () => {
    // Sanity: each entry's value is a non-empty string and the
    // set of values has no duplicates.
    const values = Object.values(TOOL_NAMES);
    assert.equal(new Set(values).size, values.length);
    for (const val of values) {
      assert.equal(typeof val, "string");
      assert.ok(val.length > 0);
    }
  });

  it("ALL_TOOL_NAMES matches Object.values(TOOL_NAMES)", () => {
    assert.deepEqual([...ALL_TOOL_NAMES], Object.values(TOOL_NAMES));
  });

  it("includes core plugin names", () => {
    // Spot-check: a rename of any of these requires a coordinated
    // server + client update. If the string changes, this test
    // should fail loudly.
    assert.equal(TOOL_NAMES.manageTodoList, "manageTodoList");
    assert.equal(TOOL_NAMES.presentDocument, "presentDocument");
    assert.equal(TOOL_NAMES.presentHtml, "presentHtml");
    assert.equal(TOOL_NAMES.switchRole, "switchRole");
  });
});

describe("isToolName", () => {
  it("accepts every literal in TOOL_NAMES", () => {
    for (const name of ALL_TOOL_NAMES) {
      assert.equal(isToolName(name), true, `should accept "${name}"`);
    }
  });

  it("rejects non-strings", () => {
    assert.equal(isToolName(null), false);
    assert.equal(isToolName(undefined), false);
    assert.equal(isToolName(42), false);
    assert.equal(isToolName({}), false);
    assert.equal(isToolName(["manageTodoList"]), false);
  });

  it("rejects unknown strings", () => {
    assert.equal(isToolName(""), false);
    assert.equal(isToolName("presentHTML"), false); // typo of presentHtml
    assert.equal(isToolName("manageTodos"), false); // near-miss
    assert.equal(isToolName("nonExistentPlugin"), false);
  });

  it("narrows the type after a successful check", () => {
    const input: unknown = "manageWiki";
    if (isToolName(input)) {
      // If this compiles, the narrowing works.
      const toolName: ToolName = input;
      assert.equal(toolName, "manageWiki");
    } else {
      assert.fail("expected narrow to succeed for a valid tool name");
    }
  });
});
