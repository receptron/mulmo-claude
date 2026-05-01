import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { homedir } from "node:os";
import { WORKSPACE_DIRS, WORKSPACE_PATHS, WORKSPACE_FILES, EAGER_WORKSPACE_DIRS, workspacePath } from "../../server/workspace/paths.js";

const expectedWorkspacePath = path.join(homedir(), "mulmoclaude");

describe("workspacePath", () => {
  it("points to ~/mulmoclaude", () => {
    assert.equal(workspacePath, expectedWorkspacePath);
  });
});

// Snapshot guard: adding/removing a key from WORKSPACE_DIRS must be
// deliberate. If a key is accidentally deleted, this test fails and
// the author knows to update EAGER_WORKSPACE_DIRS / consumers.
describe("WORKSPACE_DIRS expected keys", () => {
  const expectedKeys = [
    "accounting",
    "accountingBooks",
    "attachments",
    "calendar",
    "charts",
    "chat",
    "configs",
    "contacts",
    "github",
    "helps",
    "html",
    "htmls",
    "images",
    "markdowns",
    "memoryDir",
    "news",
    "roles",
    "scheduler",
    "searches",
    "sources",
    "spreadsheets",
    "stories",
    "summaries",
    "todos",
    "transports",
    "wiki",
    "wikiHistory",
    "wikiPages",
    "wikiSources",
  ];

  it("has all expected keys", () => {
    const actual = Object.keys(WORKSPACE_DIRS).sort();
    assert.deepEqual(actual, expectedKeys);
  });

  it("every value is a non-empty string", () => {
    Object.entries(WORKSPACE_DIRS).forEach(([key, val]) => {
      assert.equal(typeof val, "string", `${key} should be a string`);
      assert.ok(val.length > 0, `${key} should not be empty`);
    });
  });
});

describe("WORKSPACE_PATHS mirrors WORKSPACE_DIRS + WORKSPACE_FILES", () => {
  it("every WORKSPACE_DIRS key has a matching WORKSPACE_PATHS entry", () => {
    Object.keys(WORKSPACE_DIRS).forEach((key) => {
      assert.ok(key in WORKSPACE_PATHS, `WORKSPACE_PATHS missing key: ${key}`);
    });
  });

  it("every WORKSPACE_FILES key has a matching WORKSPACE_PATHS entry", () => {
    Object.keys(WORKSPACE_FILES).forEach((key) => {
      assert.ok(key in WORKSPACE_PATHS, `WORKSPACE_PATHS missing key: ${key}`);
    });
  });

  it("WORKSPACE_PATHS values are absolute paths under workspacePath", () => {
    Object.entries(WORKSPACE_PATHS).forEach(([key, absPath]) => {
      assert.equal(typeof absPath, "string", `${key} should be a string`);
      assert.ok(absPath.startsWith(workspacePath), `${key}: ${absPath} should start with ${workspacePath}`);
    });
  });
});

describe("EAGER_WORKSPACE_DIRS", () => {
  it("is a non-empty array", () => {
    assert.ok(Array.isArray(EAGER_WORKSPACE_DIRS));
    assert.ok(EAGER_WORKSPACE_DIRS.length > 0);
  });

  it("every entry is a valid WORKSPACE_DIRS key", () => {
    const validKeys = new Set(Object.keys(WORKSPACE_DIRS));
    EAGER_WORKSPACE_DIRS.forEach((key) => {
      assert.ok(validKeys.has(key), `EAGER key "${key}" not in WORKSPACE_DIRS`);
    });
  });
});
