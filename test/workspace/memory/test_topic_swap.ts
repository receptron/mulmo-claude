// Unit tests for the memory ↔ memory.next swap helper (#1070 PR-A).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { swapStagingIntoMemory } from "../../../server/workspace/memory/topic-swap.js";

async function fileExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("memory/topic-swap", () => {
  it("returns swapped:false when staging is missing", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-swap-empty-"));
    try {
      const result = await swapStagingIntoMemory(fresh);
      assert.equal(result.swapped, false);
      assert.equal(result.backupPath, null);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("renames staging into memory and parks the prior atomic dir under .atomic-backup/", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-swap-"));
    try {
      // Seed a prior atomic memory layout.
      const memDir = path.join(fresh, "conversations", "memory");
      await mkdir(memDir, { recursive: true });
      await writeFile(path.join(memDir, "preference_yarn.md"), "---\nname: yarn\ndescription: npm 不可\ntype: preference\n---\n\nyarn 固定", "utf-8");

      // Seed staging with the new layout.
      const stagingDir = path.join(fresh, "conversations", "memory.next");
      await mkdir(path.join(stagingDir, "preference"), { recursive: true });
      await writeFile(path.join(stagingDir, "preference", "dev.md"), "---\ntype: preference\ntopic: dev\n---\n\n# Dev\n\n- yarn", "utf-8");
      await writeFile(path.join(stagingDir, "MEMORY.md"), "# Memory Index\n", "utf-8");

      const result = await swapStagingIntoMemory(fresh);
      assert.equal(result.swapped, true);
      assert.ok(result.backupPath !== null);

      // memory/ now holds the new layout.
      const movedPath = path.join(fresh, "conversations", "memory", "preference", "dev.md");
      const moved = await readFile(movedPath, "utf-8");
      assert.match(moved, /yarn/);

      // memory.next/ is gone.
      assert.equal(await fileExists(path.join(fresh, "conversations", "memory.next")), false);

      // The old atomic file is parked under memory/.atomic-backup/.
      // Assert on the path components so Windows (`\` separators) and
      // POSIX (`/`) both pass the same shape check.
      const backupPath = result.backupPath ?? "";
      assert.ok(path.basename(backupPath).startsWith("memory.atomic-backup-"), `backup basename: ${backupPath}`);
      assert.equal(path.basename(path.dirname(backupPath)), ".atomic-backup", `backup parent: ${backupPath}`);
      const backedUp = await readFile(path.join(backupPath, "preference_yarn.md"), "utf-8");
      assert.match(backedUp, /yarn 固定/);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("works when there is no prior memory dir (fresh workspace)", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-swap-fresh-"));
    try {
      const stagingDir = path.join(fresh, "conversations", "memory.next");
      await mkdir(path.join(stagingDir, "interest"), { recursive: true });
      await writeFile(path.join(stagingDir, "interest", "music.md"), "---\ntype: interest\ntopic: music\n---\n\n# Music", "utf-8");

      const result = await swapStagingIntoMemory(fresh);
      assert.equal(result.swapped, true);
      assert.equal(result.backupPath, null);

      const moved = await readFile(path.join(fresh, "conversations", "memory", "interest", "music.md"), "utf-8");
      assert.match(moved, /Music/);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
