import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toSchedulerResult } from "../../src/utils/filesPreview/schedulerPreview.ts";
import { WORKSPACE_FILES } from "../../src/config/workspacePaths.ts";

describe("toSchedulerResult", () => {
  it("happy path: returns synthesized ToolResult for valid items", () => {
    const items = [
      { id: "a", title: "Alpha", createdAt: 1, props: {} },
      { id: "b", title: "Beta", createdAt: 2, props: {} },
    ];
    const result = toSchedulerResult(
      WORKSPACE_FILES.schedulerItems,
      JSON.stringify(items),
    );
    assert.ok(result);
    assert.ok(result.data);
    assert.equal(result.toolName, "manageScheduler");
    assert.equal(result.message, WORKSPACE_FILES.schedulerItems);
    assert.equal(result.title, "Scheduler");
    assert.deepEqual(result.data.items, items);
  });

  it("returns null for unrelated path even if body is a valid item array", () => {
    const items = [{ id: "a", title: "Alpha", createdAt: 1, props: {} }];
    assert.equal(
      toSchedulerResult("data/other/items.json", JSON.stringify(items)),
      null,
    );
  });

  it("returns null for null raw text (e.g. non-text file)", () => {
    assert.equal(toSchedulerResult(WORKSPACE_FILES.schedulerItems, null), null);
  });

  it("returns null for null path", () => {
    assert.equal(toSchedulerResult(null, "[]"), null);
  });

  it("returns null when JSON is malformed", () => {
    assert.equal(
      toSchedulerResult(WORKSPACE_FILES.schedulerItems, "{not json"),
      null,
    );
  });

  it("returns null when parsed value isn't an array", () => {
    assert.equal(
      toSchedulerResult(WORKSPACE_FILES.schedulerItems, '{"foo":1}'),
      null,
    );
  });

  it("returns null when array contains an element missing required fields", () => {
    // Missing `title`
    const bad = [{ id: "a", createdAt: 1, props: {} }];
    assert.equal(
      toSchedulerResult(WORKSPACE_FILES.schedulerItems, JSON.stringify(bad)),
      null,
    );
  });

  it("returns null when id is not a string", () => {
    const bad = [{ id: 42, title: "x", createdAt: 1, props: {} }];
    assert.equal(
      toSchedulerResult(WORKSPACE_FILES.schedulerItems, JSON.stringify(bad)),
      null,
    );
  });

  it("empty array → empty items list (still valid)", () => {
    const result = toSchedulerResult(WORKSPACE_FILES.schedulerItems, "[]");
    assert.ok(result);
    assert.ok(result.data);
    assert.deepEqual(result.data.items, []);
  });

  it("array containing null → rejected", () => {
    assert.equal(
      toSchedulerResult(WORKSPACE_FILES.schedulerItems, "[null]"),
      null,
    );
  });
});
