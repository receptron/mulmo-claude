import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { loadTodos, saveTodos, loadColumns, saveColumns } from "../../../server/utils/files/todos-io.js";

let root: string;

before(() => {
  root = mkdtempSync(path.join(tmpdir(), "todos-io-test-"));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("loadTodos / saveTodos", () => {
  it("returns fallback when file is missing", () => {
    assert.deepEqual(loadTodos([], root), []);
  });

  it("round-trips items", () => {
    const items = [{ id: "1", text: "buy milk" }];
    saveTodos(items, root);
    assert.deepEqual(loadTodos([], root), items);
  });

  it("creates parent dir on save", () => {
    const freshRoot = mkdtempSync(path.join(tmpdir(), "todos-io-nodir-"));
    saveTodos([{ id: "2", text: "test" }], freshRoot);
    assert.deepEqual(loadTodos([], freshRoot), [{ id: "2", text: "test" }]);
    rmSync(freshRoot, { recursive: true, force: true });
  });

  it("returns fallback on corrupt JSON (not crash)", () => {
    const corruptRoot = mkdtempSync(path.join(tmpdir(), "todos-corrupt-"));
    const dir = path.join(corruptRoot, "data", "todos");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "todos.json"), "{broken json");
    // Should NOT throw — returns fallback and logs
    assert.deepEqual(loadTodos([], corruptRoot), []);
    rmSync(corruptRoot, { recursive: true, force: true });
  });
});

describe("loadColumns / saveColumns", () => {
  it("returns fallback when file is missing", () => {
    const freshRoot = mkdtempSync(path.join(tmpdir(), "cols-io-test-"));
    assert.deepEqual(loadColumns(["default"], freshRoot), ["default"]);
    rmSync(freshRoot, { recursive: true, force: true });
  });

  it("round-trips columns", () => {
    const cols = [{ id: "backlog", label: "Backlog" }];
    saveColumns(cols, root);
    assert.deepEqual(loadColumns([], root), cols);
  });
});
