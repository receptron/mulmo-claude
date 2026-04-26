import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLegacyAutomationsShape } from "../../../src/plugins/scheduler/legacyShape.js";

describe("isLegacyAutomationsShape — task-shape keys (return true)", () => {
  it("createTask result: { task: ... }", () => {
    assert.equal(isLegacyAutomationsShape({ task: { id: "t1", name: "x" } }), true);
  });

  it("listTasks result: { tasks: [...] }", () => {
    assert.equal(isLegacyAutomationsShape({ tasks: [] }), true);
  });

  it("runTask result: { triggered, chatSessionId }", () => {
    assert.equal(isLegacyAutomationsShape({ triggered: "t1", chatSessionId: "abc" }), true);
  });

  it("deleteTask result: { deleted }", () => {
    assert.equal(isLegacyAutomationsShape({ deleted: "t1" }), true);
  });
});

describe("isLegacyAutomationsShape — calendar / unknown shapes (return false)", () => {
  it("calendar items shape: { items: [...] }", () => {
    assert.equal(isLegacyAutomationsShape({ items: [{ id: "a", title: "A" }] }), false);
  });

  it("empty object", () => {
    assert.equal(isLegacyAutomationsShape({}), false);
  });

  it("null", () => {
    assert.equal(isLegacyAutomationsShape(null), false);
  });

  it("undefined", () => {
    assert.equal(isLegacyAutomationsShape(undefined), false);
  });

  it("string", () => {
    assert.equal(isLegacyAutomationsShape("task"), false);
  });

  it("array (even when first element looks task-y)", () => {
    assert.equal(isLegacyAutomationsShape([{ task: "x" }]), false);
  });

  it("object with adjacent-but-different key (defensive, fails open to calendar)", () => {
    // A future schema change that adds e.g. `taskList` should NOT
    // silently pass through. The test here pins the narrow key list
    // — update both helper and test together when the schema grows.
    assert.equal(isLegacyAutomationsShape({ taskList: [] }), false);
    assert.equal(isLegacyAutomationsShape({ trigger: "x" }), false); // singular, not plural
  });
});
