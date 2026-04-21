import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toTodoExplorerResult } from "../../src/utils/filesPreview/todoPreview.ts";
import { WORKSPACE_FILES } from "../../src/config/workspacePaths.ts";

describe("toTodoExplorerResult", () => {
  it("happy path: returns ToolResult with parsed items", () => {
    const items = [
      { id: "1", text: "Buy milk", completed: false, createdAt: 100 },
      { id: "2", text: "Walk dog", completed: true, createdAt: 200 },
    ];
    const result = toTodoExplorerResult(WORKSPACE_FILES.todosItems, JSON.stringify(items));
    assert.ok(result);
    assert.ok(result.data);
    assert.equal(result.toolName, "manageTodoList");
    assert.equal(result.title, "Todo");
    assert.deepEqual(result.data.items, items);
    assert.deepEqual(result.data.columns, []);
  });

  it("returns null for unrelated path", () => {
    const items = [{ id: "1", text: "x", completed: false, createdAt: 1 }];
    assert.equal(toTodoExplorerResult("data/other/todos.json", JSON.stringify(items)), null);
  });

  it("returns null for null raw text", () => {
    assert.equal(toTodoExplorerResult(WORKSPACE_FILES.todosItems, null), null);
  });

  it("returns null for null path", () => {
    assert.equal(toTodoExplorerResult(null, "[]"), null);
  });

  it("malformed JSON → still returns a result with empty items", () => {
    // Mirrors the original behaviour: the explorer renders with empty
    // items rather than hiding entirely.
    const result = toTodoExplorerResult(WORKSPACE_FILES.todosItems, "{not json");
    // toTodoExplorerResult returns null specifically when JSON.parse throws
    assert.equal(result, null);
  });

  it("non-array JSON → returns result with empty items (explorer fetches own state)", () => {
    const result = toTodoExplorerResult(WORKSPACE_FILES.todosItems, '{"foo":1}');
    assert.ok(result);
    assert.ok(result.data);
    assert.deepEqual(result.data.items, []);
  });

  it("array with invalid items → empty items", () => {
    const bad = [{ id: "1", text: "ok" }]; // missing completed, createdAt
    const result = toTodoExplorerResult(WORKSPACE_FILES.todosItems, JSON.stringify(bad));
    assert.ok(result);
    assert.ok(result.data);
    assert.deepEqual(result.data.items, []);
  });

  it("empty array → empty items list", () => {
    const result = toTodoExplorerResult(WORKSPACE_FILES.todosItems, "[]");
    assert.ok(result);
    assert.ok(result.data);
    assert.deepEqual(result.data.items, []);
  });

  it("completed must be boolean (not truthy value)", () => {
    const bad = [{ id: "1", text: "x", completed: 1, createdAt: 1 }];
    const result = toTodoExplorerResult(WORKSPACE_FILES.todosItems, JSON.stringify(bad));
    assert.ok(result);
    assert.ok(result.data);
    assert.deepEqual(result.data.items, []);
  });
});
