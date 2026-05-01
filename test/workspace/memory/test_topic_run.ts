// Unit tests for runTopicMigrationOnce's idempotency guards
// (#1070 PR-B). Mirrors the structure of #1029's `test_run.ts`.
//
// The clusterer summarize is stubbed so these tests never invoke
// the real Claude CLI.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeMemoryEntry } from "../../../server/workspace/memory/io.js";
import { runTopicMigrationOnce } from "../../../server/workspace/memory/topic-run.js";
import { topicStagingPath } from "../../../server/workspace/memory/topic-migrate.js";
import type { Summarize } from "../../../server/workspace/journal/archivist-cli.js";

const stubSummarize: Summarize = async () =>
  JSON.stringify({
    preference: [{ topic: "dev", unsectionedBullets: ["yarn"] }],
    interest: [],
    fact: [],
    reference: [],
  });

describe("memory/topic-run — idempotency guards", () => {
  it("is a no-op when the workspace already uses the topic format", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-run-already-"));
    try {
      // Pre-create a `<type>/` subdir to signal post-swap state.
      await mkdir(path.join(fresh, "conversations", "memory", "interest"), { recursive: true });
      // Add an atomic entry alongside; the runner should still skip.
      await writeMemoryEntry(fresh, {
        name: "yarn",
        description: "npm 不可",
        type: "preference",
        body: "yarn",
        slug: "preference_yarn",
      });
      await runTopicMigrationOnce(fresh, { summarize: stubSummarize });
      const stagingExists = await stat(topicStagingPath(fresh)).catch(() => null);
      assert.equal(stagingExists, null, "post-swap workspace should not produce staging");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("retries the swap (no LLM call) when staging is left over from a prior crashed run", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-run-staged-"));
    try {
      // Pre-create a complete staging tree as if a previous run
      // clustered successfully but crashed before swap.
      const stagingPath = topicStagingPath(fresh);
      await mkdir(path.join(stagingPath, "preference"), { recursive: true });
      await writeFile(path.join(stagingPath, "preference", "dev.md"), "---\ntype: preference\ntopic: dev\n---\n\n# Dev\n\n- yarn", "utf-8");
      await writeFile(path.join(stagingPath, "MEMORY.md"), "# Memory Index\n", "utf-8");
      let summarizeCalled = false;
      const summarize: Summarize = async () => {
        summarizeCalled = true;
        return "{}";
      };
      await runTopicMigrationOnce(fresh, { summarize });

      // No LLM call — the runner short-circuits to swap.
      assert.equal(summarizeCalled, false, "existing staging must skip the cluster step");
      // Staging is gone (renamed into memory/).
      const stagingExists = await stat(stagingPath).catch(() => null);
      assert.equal(stagingExists, null, "swap must have promoted the staging tree");
      // Topic format active in memory/.
      const moved = await stat(path.join(fresh, "conversations", "memory", "preference", "dev.md"));
      assert.ok(moved.isFile());
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("is a no-op when there are no atomic entries to migrate (fresh workspace)", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-run-empty-"));
    try {
      await runTopicMigrationOnce(fresh, { summarize: stubSummarize });
      const stagingExists = await stat(topicStagingPath(fresh)).catch(() => null);
      assert.equal(stagingExists, null);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("defers when the legacy memory.md is still in flight (#1029 migration not done yet)", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-run-legacy-"));
    try {
      const legacyPath = path.join(fresh, "conversations", "memory.md");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      // Past the 64-byte placeholder threshold from
      // runMemoryMigrationOnce, so the topic runner reads it as
      // "in flight" and defers.
      await writeFile(
        legacyPath,
        ["# Memory", "", "Distilled facts about you and your work.", "", "## Preferences", "- yarn を使う（npm 不可）", "- Emacs を愛用", ""].join("\n"),
        "utf-8",
      );
      await writeMemoryEntry(fresh, {
        name: "yarn",
        description: "npm 不可",
        type: "preference",
        body: "yarn",
        slug: "preference_yarn",
      });
      await runTopicMigrationOnce(fresh, { summarize: stubSummarize });
      const stagingExists = await stat(topicStagingPath(fresh)).catch(() => null);
      assert.equal(stagingExists, null, "topic migration should defer until the legacy migration finishes");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("proceeds when memory.md sits next to a memory.md.backup (legacy migration already completed)", async () => {
    // Real-world bug surfaced in review: a workspace where the
    // legacy `runMemoryMigrationOnce` finished once (so `.backup`
    // exists) and then the user dropped `memory.md` back in. The
    // legacy runner now refuses to re-process — the topic runner
    // must NOT keep deferring or the workspace is stuck forever.
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-run-postlegacy-"));
    try {
      const legacyPath = path.join(fresh, "conversations", "memory.md");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(
        legacyPath,
        ["# Memory", "", "Distilled facts about you and your work.", "", "## Preferences", "- yarn を使う（npm 不可）", "- Emacs を愛用", ""].join("\n"),
        "utf-8",
      );
      // `.backup` present means a prior successful legacy migration
      // already fired. Without the bugfix, the topic runner would
      // see the >=64-byte memory.md and defer indefinitely.
      await writeFile(`${legacyPath}.backup`, "older legacy contents\n", "utf-8");
      await writeMemoryEntry(fresh, {
        name: "yarn",
        description: "npm 不可",
        type: "preference",
        body: "yarn",
        slug: "preference_yarn",
      });
      await runTopicMigrationOnce(fresh, { summarize: stubSummarize });
      // Auto-swap leaves the workspace on the topic format —
      // staging is gone, `<type>/` subdirs exist under memory/.
      const stagingExists = await stat(topicStagingPath(fresh)).catch(() => null);
      assert.equal(stagingExists, null, "auto-swap must remove staging");
      const subdir = await stat(path.join(fresh, "conversations", "memory", "preference"));
      assert.ok(subdir.isDirectory(), "topic format must be active in memory/");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("proceeds and auto-swaps when atomic entries are present and no other guard fires", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-run-go-"));
    try {
      await writeMemoryEntry(fresh, {
        name: "yarn",
        description: "npm 不可",
        type: "preference",
        body: "yarn",
        slug: "preference_yarn",
      });
      await runTopicMigrationOnce(fresh, { summarize: stubSummarize });
      // memory.next/ is gone (auto-swapped).
      const stagingExists = await stat(topicStagingPath(fresh)).catch(() => null);
      assert.equal(stagingExists, null);
      // Topic format active in memory/.
      const written = await stat(path.join(fresh, "conversations", "memory", "preference", "dev.md"));
      assert.ok(written.isFile(), "expected the clustered topic file to land in memory/ post-swap");
      // Atomic backup parked in `.atomic-backup/`.
      const atomicBackup = await stat(path.join(fresh, "conversations", "memory", ".atomic-backup"));
      assert.ok(atomicBackup.isDirectory(), "expected atomic files preserved under .atomic-backup/");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
