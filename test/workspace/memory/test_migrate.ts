// Unit tests for legacy `memory.md` migration (#1029 PR-A).
//
// The classifier is injected as a stub so these tests run without
// any LLM dependency. Real production migration in PR-B will pass
// in a real LLM-backed classifier.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadAllMemoryEntries, memoryDirOf, memoryIndexOf } from "../../../server/workspace/memory/io.js";
import { migrateLegacyMemory, writeLegacyMemoryForTest, type MemoryClassifier } from "../../../server/workspace/memory/migrate.js";
import type { MemoryType } from "../../../server/workspace/memory/types.js";

// Predictable classifier: name → type. Anything not listed → null
// (skipped). Lets the test assert exactly which lines moved.
function classifierFor(map: Record<string, MemoryType>): MemoryClassifier {
  return async ({ body }) => {
    for (const [needle, type] of Object.entries(map)) {
      if (body.includes(needle)) return { type };
    }
    return null;
  };
}

describe("memory/migrate — happy path", () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "mulmoclaude-memory-mig-"));
    await writeLegacyMemoryForTest(
      workspaceRoot,
      [
        "# Memory",
        "",
        "## Preferences",
        "- yarn を使う（npm は不可）",
        "- Emacs を愛用",
        "",
        "## Project",
        "- mulmoclaude のレポは ~/ss/llm/mulmoclaude4",
        "",
        "## Travel",
        "- エジプト旅行を計画中",
        "",
        "## Junk",
        "- 5 文字以上の意味不明な行",
        "",
      ].join("\n"),
    );
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("classifies bullets, writes typed entries, regenerates the index, and renames the source", async () => {
    const result = await migrateLegacyMemory(
      workspaceRoot,
      classifierFor({
        yarn: "preference",
        Emacs: "preference",
        "mulmoclaude のレポ": "reference",
        エジプト: "fact",
      }),
    );
    assert.equal(result.noop, false);
    assert.equal(result.written.preference, 2);
    assert.equal(result.written.fact, 1);
    assert.equal(result.written.reference, 1);
    assert.equal(result.written.interest, 0);
    assert.equal(result.skippedByClassifier, 1, "the unclassified bullet is counted as skipped");

    const all = await loadAllMemoryEntries(workspaceRoot);
    const types = all.map((entry) => entry.type).sort();
    assert.deepEqual(types, ["fact", "preference", "preference", "reference"]);

    const indexBody = await readFile(memoryIndexOf(workspaceRoot), "utf8");
    assert.match(indexBody, /yarn を使う/);
    assert.match(indexBody, /エジプト/);

    // memory.md → memory.md.backup
    const sourceGone = await stat(path.join(workspaceRoot, "conversations", "memory.md")).catch(() => null);
    assert.equal(sourceGone, null);
    const backup = await readFile(path.join(workspaceRoot, "conversations", "memory.md.backup"), "utf8");
    assert.match(backup, /yarn を使う/);
  });
});

describe("memory/migrate — edge cases", () => {
  it("returns noop when memory.md does not exist", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-memory-mig-empty-"));
    try {
      const result = await migrateLegacyMemory(fresh, async () => null);
      assert.equal(result.noop, true);
      // No memory dir was provisioned.
      const dirGone = await stat(memoryDirOf(fresh)).catch(() => null);
      assert.equal(dirGone, null);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("counts skips when classifier returns null for every candidate", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-memory-mig-skip-"));
    try {
      await writeLegacyMemoryForTest(fresh, ["# Memory", "## Junk", "- one", "- two", "- three", ""].join("\n"));
      const result = await migrateLegacyMemory(fresh, async () => null);
      assert.equal(result.skippedByClassifier, 3);
      assert.equal(result.written.preference, 0);
      const all = await loadAllMemoryEntries(fresh);
      assert.deepEqual(all, []);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("counts a write error without aborting the rest of the batch", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-memory-mig-err-"));
    try {
      await writeLegacyMemoryForTest(fresh, ["# Memory", "## Mixed", "- A", "- B", ""].join("\n"));
      // Classifier returns a malformed verdict for "A" by claiming a
      // type the schema rejects. The migration counts the skip and
      // still writes "B".
      const classifier: MemoryClassifier = async ({ body }) => {
        if (body === "A") return { type: "bogus" as MemoryType };
        return { type: "fact" };
      };
      const result = await migrateLegacyMemory(fresh, classifier);
      assert.equal(result.written.fact, 1);
      assert.equal(result.skippedByClassifier, 1);
      assert.equal(result.writeErrors, 0);
      const all = await loadAllMemoryEntries(fresh);
      assert.equal(all.length, 1);
      assert.equal(all[0].type, "fact");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("leaves the legacy source in place when zero entries got written, so a later run can retry", async () => {
    // Reproduces the #1058 review concern: if the classifier
    // returned null for every candidate (or every write threw),
    // the prior code still renamed `memory.md` → `.backup`,
    // stranding the data unrecoverably.
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-memory-mig-noop-"));
    try {
      const sourcePath = path.join(fresh, "conversations", "memory.md");
      await writeLegacyMemoryForTest(fresh, ["# Memory", "## Junk", "- one", "- two", ""].join("\n"));
      await migrateLegacyMemory(fresh, async () => null);
      // Source still present, no .backup yet.
      const sourceStat = await stat(sourcePath);
      assert.ok(sourceStat.isFile());
      const backupGone = await stat(`${sourcePath}.backup`).catch(() => null);
      assert.equal(backupGone, null, "backup must NOT exist when nothing was written");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("seeds the slug-dedupe set from existing entries so a re-run can't overwrite a prior file", async () => {
    // Reproduces the #1058 review concern: previously `usedSlugs`
    // started empty, so a re-run that re-classified the same
    // bullet would synthesize the same slug and `writeMemoryEntry`
    // would happily overwrite the prior file.
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-memory-mig-seed-"));
    try {
      // Seed an existing entry with the slug "preference_yarn".
      const { writeMemoryEntry } = await import("../../../server/workspace/memory/io.js");
      await writeMemoryEntry(fresh, {
        name: "yarn (existing)",
        description: "pinned",
        type: "preference",
        body: "yarn を使う",
        slug: "preference_yarn",
      });
      // Now run migration on a memory.md that would synthesize the
      // same slug.
      await writeLegacyMemoryForTest(fresh, ["# Memory", "## Preferences", "- yarn を使う", ""].join("\n"));
      const result = await migrateLegacyMemory(fresh, classifierFor({ yarn: "preference" }));
      // Should still write, but under a deduped slug — and the
      // prior file should remain unchanged.
      const all = await loadAllMemoryEntries(fresh);
      const yarn = all.find((entry) => entry.slug === "preference_yarn");
      assert.ok(yarn, "the original `preference_yarn` entry must still be present");
      assert.equal(yarn.name, "yarn (existing)", "the original entry's name must be preserved");
      assert.equal(result.writeErrors, 0);
      assert.equal(all.length, 2, "migration should add a deduped second entry, not overwrite the first");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
