import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadTodos,
  saveTodos,
  loadColumns,
  saveColumns,
} from "../../../server/utils/files/todos-io.js";

let root: string;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "todos-io-test-"));
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
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
    const freshRoot = fs.mkdtempSync(path.join(os.tmpdir(), "todos-io-nodir-"));
    saveTodos([{ id: "2", text: "test" }], freshRoot);
    assert.deepEqual(loadTodos([], freshRoot), [{ id: "2", text: "test" }]);
    fs.rmSync(freshRoot, { recursive: true, force: true });
  });

  it("returns fallback on corrupt JSON (not crash)", () => {
    const corruptRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "todos-corrupt-"),
    );
    const dir = path.join(corruptRoot, "data", "todos");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "todos.json"), "{broken json");
    // Should NOT throw — returns fallback and logs
    assert.deepEqual(loadTodos([], corruptRoot), []);
    fs.rmSync(corruptRoot, { recursive: true, force: true });
  });
});

describe("loadColumns / saveColumns", () => {
  it("returns fallback when file is missing", () => {
    const freshRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cols-io-test-"));
    assert.deepEqual(loadColumns(["default"], freshRoot), ["default"]);
    fs.rmSync(freshRoot, { recursive: true, force: true });
  });

  it("round-trips columns", () => {
    const cols = [{ id: "backlog", label: "Backlog" }];
    saveColumns(cols, root);
    assert.deepEqual(loadColumns([], root), cols);
  });
});
