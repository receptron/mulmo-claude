// Unit tests for memory storage IO (#1029 PR-A).
//
// Covers the round-trip (write then read), the index regeneration
// shape, and the reader's tolerance of malformed files — a single
// corrupt entry must not block the rest of the directory.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { isSafeMemorySlug, loadAllMemoryEntries, memoryDirOf, memoryIndexOf, regenerateIndex, writeMemoryEntry } from "../../../server/workspace/memory/io.js";
import type { MemoryEntry } from "../../../server/workspace/memory/types.js";

let workspaceRoot: string;

before(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "mulmoclaude-memory-io-"));
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("memory/io — write + read round-trip", () => {
  it("writes an entry with a frontmatter envelope and reads the same fields back", async () => {
    const entry: MemoryEntry = {
      name: "yarn を使う",
      description: "パッケージマネージャは yarn 固定（npm 不可）",
      type: "preference",
      body: "yarn install / yarn add しか使わない。",
      slug: "preference_yarn",
    };
    const writtenRel = await writeMemoryEntry(workspaceRoot, entry);
    assert.equal(writtenRel, "conversations/memory/preference_yarn.md");

    const all = await loadAllMemoryEntries(workspaceRoot);
    assert.equal(all.length, 1);
    const [loaded] = all;
    assert.equal(loaded.name, entry.name);
    assert.equal(loaded.description, entry.description);
    assert.equal(loaded.type, entry.type);
    assert.equal(loaded.slug, entry.slug);
    assert.match(loaded.body, /yarn install/);
  });
});

describe("memory/io — reader tolerance", () => {
  let scopedRoot: string;

  before(async () => {
    scopedRoot = await mkdtemp(path.join(tmpdir(), "mulmoclaude-memory-io-tol-"));
  });

  after(async () => {
    await rm(scopedRoot, { recursive: true, force: true });
  });

  it("skips files without a frontmatter envelope but loads the rest", async () => {
    const dir = memoryDirOf(scopedRoot);
    await writeMemoryEntry(scopedRoot, {
      name: "印象派",
      description: "美術鑑賞の主軸",
      type: "interest",
      body: "monet / renoir.",
      slug: "interest_impressionism",
    });
    // Drop a malformed file alongside.
    await writeFile(path.join(dir, "broken.md"), "no frontmatter here.\n", "utf8");

    const all = await loadAllMemoryEntries(scopedRoot);
    assert.equal(all.length, 1);
    assert.equal(all[0].slug, "interest_impressionism");
  });

  it("skips MEMORY.md and dotfiles in the directory listing", async () => {
    const dir = memoryDirOf(scopedRoot);
    await writeFile(path.join(dir, "MEMORY.md"), "# index\n", "utf8");
    await writeFile(path.join(dir, ".hidden.md"), "irrelevant\n", "utf8");

    const all = await loadAllMemoryEntries(scopedRoot);
    // Still exactly the one valid entry from the previous test.
    assert.equal(all.length, 1);
  });

  it("returns an empty array when the memory directory does not exist", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-memory-io-empty-"));
    try {
      const all = await loadAllMemoryEntries(fresh);
      assert.deepEqual(all, []);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});

describe("memory/io — slug safety", () => {
  it("accepts a typical generated slug", () => {
    assert.equal(isSafeMemorySlug("preference_yarn"), true);
    assert.equal(isSafeMemorySlug("fact_egypt-trip-2"), true);
    assert.equal(isSafeMemorySlug("interest_印象派"), true);
  });

  it("rejects slugs that would escape the memory directory", () => {
    assert.equal(isSafeMemorySlug(".."), false);
    assert.equal(isSafeMemorySlug("../foo"), false);
    assert.equal(isSafeMemorySlug("a/b"), false);
    assert.equal(isSafeMemorySlug("a\\b"), false);
    assert.equal(isSafeMemorySlug("foo\0bar"), false);
  });

  it("rejects empty / dotfile / reserved slugs", () => {
    assert.equal(isSafeMemorySlug(""), false);
    assert.equal(isSafeMemorySlug(".hidden"), false);
    assert.equal(isSafeMemorySlug("MEMORY"), false);
  });

  it("rejects every case-fold of the reserved index name (case-insensitive FS safety)", () => {
    // macOS / Windows are case-insensitive by default — `Memory.md`
    // aliases `MEMORY.md` on those filesystems and would shadow the
    // index. The check must be case-fold, not byte-equal.
    assert.equal(isSafeMemorySlug("Memory"), false);
    assert.equal(isSafeMemorySlug("memory"), false);
    assert.equal(isSafeMemorySlug("MeMoRy"), false);
  });

  it("writeMemoryEntry throws on unsafe slug instead of writing outside the memory directory", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-memory-io-slug-"));
    try {
      const malicious: MemoryEntry = {
        name: "evil",
        description: "should not write",
        type: "fact",
        body: "x",
        slug: "../../../../tmp/pwn",
      };
      await assert.rejects(() => writeMemoryEntry(fresh, malicious), /unsafe slug/);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});

describe("memory/io — regenerateIndex", () => {
  let scopedRoot: string;

  before(async () => {
    scopedRoot = await mkdtemp(path.join(tmpdir(), "mulmoclaude-memory-io-idx-"));
    await writeMemoryEntry(scopedRoot, {
      name: "印象派",
      description: "美術鑑賞の主軸",
      type: "interest",
      body: "monet / renoir.",
      slug: "interest_impressionism",
    });
    await writeMemoryEntry(scopedRoot, {
      name: "yarn を使う",
      description: "npm 不可",
      type: "preference",
      body: "yarn 固定。",
      slug: "preference_yarn",
    });
    await writeMemoryEntry(scopedRoot, {
      name: "エジプト旅行を計画中",
      description: "ナイル川クルーズ案",
      type: "fact",
      body: "ピラミッド + 博物館中心。",
      slug: "fact_egypt",
    });
  });

  after(async () => {
    await rm(scopedRoot, { recursive: true, force: true });
  });

  it("emits a markdown index sorted by type then name", async () => {
    await regenerateIndex(scopedRoot);
    const indexPath = memoryIndexOf(scopedRoot);
    const content = await readFile(indexPath, "utf8");
    // preference first, then interest, then fact.
    const prefIdx = content.indexOf("preference_yarn.md");
    const intIdx = content.indexOf("interest_impressionism.md");
    const factIdx = content.indexOf("fact_egypt.md");
    assert.ok(prefIdx !== -1 && intIdx !== -1 && factIdx !== -1, "all entries appear");
    assert.ok(prefIdx < intIdx, "preference precedes interest");
    assert.ok(intIdx < factIdx, "interest precedes fact");
  });

  it("writes an empty placeholder when there are no entries", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-memory-io-empty-idx-"));
    try {
      await regenerateIndex(fresh);
      const content = await readFile(memoryIndexOf(fresh), "utf8");
      assert.match(content, /no entries yet/);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
