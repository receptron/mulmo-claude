// Unit tests for the async tree walk + shallow-listing helpers
// extracted from `server/api/routes/files.ts` in #200.
//
// Both helpers are pure in the sense that they take an absolute path
// + relative path and return a TreeNode — no Express coupling — so we
// can exercise them against a tmp dir fixture without a running
// server.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildTreeAsync, listDirShallow } from "../../server/api/routes/files.js";

// Rough shape — the real TreeNode type isn't exported so we match on
// the fields we assert against.
interface TreeNodeShape {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  children?: TreeNodeShape[];
}

async function setupFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "files-tree-"));
  // root/
  //   a.md
  //   dir1/
  //     b.md
  //     sub/
  //       c.md
  //   .git/           ← hidden, should NOT appear
  //     config
  //   .env            ← sensitive, should NOT appear
  //   id_rsa          ← sensitive, should NOT appear
  //   ok.key          ← sensitive (ext), should NOT appear
  await writeFile(path.join(root, "a.md"), "a");
  await mkdir(path.join(root, "dir1", "sub"), { recursive: true });
  await writeFile(path.join(root, "dir1", "b.md"), "b");
  await writeFile(path.join(root, "dir1", "sub", "c.md"), "c");
  await mkdir(path.join(root, ".git"));
  await writeFile(path.join(root, ".git", "config"), "hidden");
  await writeFile(path.join(root, ".env"), "SECRET=1");
  await writeFile(path.join(root, "id_rsa"), "private");
  await writeFile(path.join(root, "ok.key"), "key");
  return root;
}

describe("buildTreeAsync", () => {
  let root: string;

  before(async () => {
    root = await setupFixture();
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("walks the workspace recursively and returns a rooted TreeNode", async () => {
    const tree = (await buildTreeAsync(root, "")) as TreeNodeShape;
    assert.equal(tree.type, "dir");
    assert.equal(tree.path, "");
    assert.ok(Array.isArray(tree.children));
  });

  it("orders dirs before files, alphabetically within type", async () => {
    const tree = (await buildTreeAsync(root, "")) as TreeNodeShape;
    const names = (tree.children ?? []).map((child) => child.name);
    // dir1 (dir) should come before a.md (file).
    assert.ok(names.indexOf("dir1") < names.indexOf("a.md"));
  });

  it("hides `.git/` hidden dir", async () => {
    const tree = (await buildTreeAsync(root, "")) as TreeNodeShape;
    const names = (tree.children ?? []).map((child) => child.name);
    assert.ok(!names.includes(".git"));
  });

  it("hides `.env`, `id_rsa`, and `*.key` sensitive files", async () => {
    const tree = (await buildTreeAsync(root, "")) as TreeNodeShape;
    const names = (tree.children ?? []).map((child) => child.name);
    assert.ok(!names.includes(".env"));
    assert.ok(!names.includes("id_rsa"));
    assert.ok(!names.includes("ok.key"));
  });

  it("recurses into subdirs (sub/c.md reachable via dir1/sub)", async () => {
    const tree = (await buildTreeAsync(root, "")) as TreeNodeShape;
    const dir1 = (tree.children ?? []).find((child) => child.name === "dir1");
    assert.ok(dir1);
    const sub = (dir1.children ?? []).find((child) => child.name === "sub");
    assert.ok(sub);
    const leaf = (sub.children ?? []).find((node) => node.name === "c.md");
    assert.ok(leaf);
    assert.equal(leaf.type, "file");
  });

  it("skips symlinks (no workspace escape)", async () => {
    // Create a symlink AFTER the fixture so it lives alongside the
    // other children; buildTreeAsync should ignore it.
    const linkTarget = await mkdtemp(path.join(tmpdir(), "files-link-"));
    const linkPath = path.join(root, "escape");
    try {
      await symlink(linkTarget, linkPath);
      const tree = (await buildTreeAsync(root, "")) as TreeNodeShape;
      const names = (tree.children ?? []).map((child) => child.name);
      assert.ok(!names.includes("escape"));
    } finally {
      await rm(linkPath, { force: true });
      await rm(linkTarget, { recursive: true, force: true });
    }
  });

  it("returns a file node for a non-directory target", async () => {
    const fileAbs = path.join(root, "a.md");
    const node = (await buildTreeAsync(fileAbs, "a.md")) as TreeNodeShape;
    assert.equal(node.type, "file");
    assert.equal(node.path, "a.md");
  });
});

describe("listDirShallow", () => {
  let root: string;

  before(async () => {
    root = await setupFixture();
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns only the immediate children, no nested `children` field on sub-dirs", async () => {
    const node = (await listDirShallow(root, "")) as TreeNodeShape;
    assert.equal(node.type, "dir");
    const dir1 = (node.children ?? []).find((child) => child.name === "dir1");
    assert.ok(dir1);
    assert.equal(dir1.type, "dir");
    // Shallow → no grandchildren materialised.
    assert.equal(dir1.children, undefined);
  });

  it("applies the same hidden/sensitive filters as the recursive walk", async () => {
    const node = (await listDirShallow(root, "")) as TreeNodeShape;
    const names = (node.children ?? []).map((child) => child.name);
    assert.ok(!names.includes(".git"));
    assert.ok(!names.includes(".env"));
    assert.ok(!names.includes("id_rsa"));
    assert.ok(!names.includes("ok.key"));
  });

  it("orders dirs before files, alphabetically", async () => {
    const node = (await listDirShallow(root, "")) as TreeNodeShape;
    const names = (node.children ?? []).map((child) => child.name);
    assert.ok(names.indexOf("dir1") < names.indexOf("a.md"));
  });

  it("reads a sub-directory when given its path", async () => {
    const subAbs = path.join(root, "dir1");
    const node = (await listDirShallow(subAbs, "dir1")) as TreeNodeShape;
    const names = (node.children ?? []).map((child) => child.name);
    // dir1 contains `b.md` (file) and `sub/` (dir).
    assert.ok(names.includes("b.md"));
    assert.ok(names.includes("sub"));
    // sub/ reported as a dir, not expanded.
    const sub = (node.children ?? []).find((child) => child.name === "sub");
    assert.equal(sub?.type, "dir");
    assert.equal(sub?.children, undefined);
  });

  it("returns an empty-dir node when the target is a file", async () => {
    const fileAbs = path.join(root, "a.md");
    const node = (await listDirShallow(fileAbs, "a.md")) as TreeNodeShape;
    assert.equal(node.type, "dir");
    assert.deepEqual(node.children, []);
  });

  it("returns an empty-dir node when the target doesn't exist", async () => {
    const missing = path.join(root, "does-not-exist");
    const node = (await listDirShallow(missing, "does-not-exist")) as TreeNodeShape;
    assert.equal(node.type, "dir");
    assert.deepEqual(node.children, []);
  });
});
