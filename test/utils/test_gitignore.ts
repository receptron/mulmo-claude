import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { GitignoreFilter, createRootFilter } from "../../server/utils/gitignore.ts";

let tmpDir = "";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mulmo-gitignore-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GitignoreFilter", () => {
  it("ignores nothing when constructed with no rules", () => {
    const f = new GitignoreFilter();
    assert.equal(f.ignores("anything.txt"), false);
    assert.equal(f.ignores("node_modules/"), false);
  });

  it("matches patterns from the constructor", () => {
    const f = new GitignoreFilter("node_modules/\ndist/\n");
    assert.equal(f.ignores("node_modules/foo.js"), true);
    assert.equal(f.ignores("dist/index.js"), true);
    assert.equal(f.ignores("src/index.ts"), false);
  });

  it("supports negation patterns", () => {
    const f = new GitignoreFilter("*.log\n!important.log\n");
    assert.equal(f.ignores("debug.log"), true);
    assert.equal(f.ignores("important.log"), false);
  });
});

describe("GitignoreFilter.childForDir", () => {
  it("inherits parent rules", () => {
    const parent = new GitignoreFilter("*.tmp\n");
    const childDir = path.join(tmpDir, "sub");
    fs.mkdirSync(childDir);
    // No .gitignore in childDir
    const child = parent.childForDir(childDir);
    assert.equal(child.ignores("foo.tmp"), true);
    assert.equal(child.ignores("foo.ts"), false);
  });

  it("adds local .gitignore rules on top of parent", () => {
    const parent = new GitignoreFilter("*.tmp\n");
    const childDir = path.join(tmpDir, "sub");
    fs.mkdirSync(childDir);
    fs.writeFileSync(path.join(childDir, ".gitignore"), "node_modules/\n");
    const child = parent.childForDir(childDir);
    // Parent rule
    assert.equal(child.ignores("foo.tmp"), true);
    // Local rule
    assert.equal(child.ignores("node_modules/package.json"), true);
    // Neither
    assert.equal(child.ignores("src/index.ts"), false);
  });
});

describe("createRootFilter", () => {
  it("returns an empty filter when no .gitignore exists", () => {
    const f = createRootFilter(tmpDir);
    assert.equal(f.ignores("anything"), false);
  });

  it("reads the root .gitignore", () => {
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), "github/\n.session-token\n");
    const f = createRootFilter(tmpDir);
    assert.equal(f.ignores("github/"), true);
    assert.equal(f.ignores("github/repo/file.ts"), true);
    assert.equal(f.ignores(".session-token"), true);
    assert.equal(f.ignores("data/todos/todos.json"), false);
  });
});
