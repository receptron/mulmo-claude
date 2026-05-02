// Unit tests for runMemoryMigrationOnce's idempotency guards
// (#1029 PR-B). The Claude CLI summarize callback is not exercised
// here — these tests verify that the runner short-circuits in the
// states where re-running would cause harm, and that it does NOT
// short-circuit in the interrupted-migration recovery state:
//   - no legacy file → skip
//   - legacy file too small to be real (placeholder threshold) → skip
//   - both legacy file AND .backup present (user re-introduced
//     legacy after a prior successful run) → skip
//   - legacy file present + typed dir partially populated +
//     no .backup yet → DO NOT skip; this is the interrupted-
//     migration retry case the plan promises.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runMemoryMigrationOnce } from "../../../server/workspace/memory/run.js";
import { ClaudeCliNotFoundError, type Summarize } from "../../../server/workspace/journal/archivist-cli.js";

describe("memory/run — idempotency guards", () => {
  let scoped: string;

  before(async () => {
    scoped = await mkdtemp(path.join(tmpdir(), "mulmoclaude-mem-run-"));
  });

  after(async () => {
    await rm(scoped, { recursive: true, force: true });
  });

  it("is a no-op when there is no legacy memory.md", async () => {
    await runMemoryMigrationOnce(scoped);
    // No legacy, no migration: nothing got written, no exception.
    const legacy = await stat(path.join(scoped, "conversations", "memory.md")).catch(() => null);
    const backup = await stat(path.join(scoped, "conversations", "memory.md.backup")).catch(() => null);
    assert.equal(legacy, null);
    assert.equal(backup, null);
  });

  it("is a no-op when the legacy file is below the placeholder threshold", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-mem-run-tiny-"));
    try {
      const legacyPath = path.join(fresh, "conversations", "memory.md");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      // Below 64 bytes — looks like the historical placeholder.
      await writeFile(legacyPath, "# Memory\n", "utf-8");

      await runMemoryMigrationOnce(fresh);

      // Legacy file untouched (no rename to .backup).
      const legacy = await stat(legacyPath);
      assert.ok(legacy.isFile(), "tiny legacy file should be left in place");
      const backup = await stat(`${legacyPath}.backup`).catch(() => null);
      assert.equal(backup, null);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("skips when memory.md.backup also exists (user re-introduced the legacy file after a prior successful run)", async () => {
    // The .backup is the "migration completed" marker (rename is the
    // final step of `migrateLegacyMemory`). When BOTH the legacy
    // file and the backup are present, the user must have restored
    // memory.md after success. Re-running here would re-classify
    // bullets and could clobber typed entries the user has been
    // editing in place.
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-mem-run-replay-"));
    try {
      const legacyPath = path.join(fresh, "conversations", "memory.md");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(legacyPath, ["# Memory", "", "## Preferences", "- yarn を使う", "- Emacs", "## Travel", "- planning Egypt", ""].join("\n"), "utf-8");
      // Pretend a prior successful run finished and renamed the
      // legacy file. The user has since restored memory.md from
      // somewhere.
      await writeFile(`${legacyPath}.backup`, "older legacy contents\n", "utf-8");

      await runMemoryMigrationOnce(fresh);

      // memory.md left in place verbatim; .backup unchanged.
      const legacy = await readFile(legacyPath, "utf-8");
      assert.match(legacy, /yarn を使う/);
      const backup = await readFile(`${legacyPath}.backup`, "utf-8");
      assert.match(backup, /older legacy contents/);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("does NOT skip on interrupted-migration retry (typed dir partially populated, no .backup yet)", async () => {
    // The plan's retry-on-restart promise: an interrupted run resumes
    // on next start. Signal: legacy file present, typed dir already
    // has some entries from the partial run, but no .backup (the
    // final rename never executed). The runner must not short-
    // circuit here — it must re-enter migration.
    //
    // We pass a stubbed summarize so the test does not invoke the
    // real Claude CLI. The classifier always picks `preference`,
    // letting us assert: migration ran (legacy renamed to .backup,
    // typed entry overwritten with the migration's classification).
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-mem-run-resume-"));
    try {
      const legacyPath = path.join(fresh, "conversations", "memory.md");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      // Pad past the 64-byte placeholder threshold so the runner
      // doesn't short-circuit on size before reaching the real
      // migration call.
      await writeFile(
        legacyPath,
        ["# Memory", "", "Distilled facts about you and your work.", "", "## Preferences", "- yarn を使う（npm は使わない）", "- Emacs を愛用", ""].join("\n"),
        "utf-8",
      );

      // A typed entry already exists from a prior interrupted run.
      const memDir = path.join(fresh, "conversations", "memory");
      await mkdir(memDir, { recursive: true });
      await writeFile(
        path.join(memDir, "preference_yarn.md"),
        "---\nname: yarn\ndescription: from prior partial run\ntype: preference\n---\n\nold body\n",
        "utf-8",
      );

      // No .backup yet — that's the retry signal.
      const backupBefore = await stat(`${legacyPath}.backup`).catch(() => null);
      assert.equal(backupBefore, null);

      const summarize: Summarize = async () => '{"type":"preference","description":"npm 不可"}';
      await runMemoryMigrationOnce(fresh, { summarize });

      // Migration ran: legacy renamed to .backup. (The early-skip
      // path would have left the legacy file in place with no
      // .backup created — this is the proof we did NOT short-
      // circuit on the .backup-present guard.)
      const legacyAfter = await stat(legacyPath).catch(() => null);
      const backupAfter = await stat(`${legacyPath}.backup`).catch(() => null);
      assert.equal(legacyAfter, null, "legacy file should have been renamed");
      assert.ok(backupAfter !== null && backupAfter.isFile(), ".backup should exist post-migration");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("aborts cleanly when the Claude CLI is missing — legacy left in place for a later retry", async () => {
    // Reproduces the #1061 review concern: previously the classifier
    // swallowed `ClaudeCliNotFoundError` per-candidate and returned
    // null, so the migration ran to completion with zero writes,
    // wrote an empty `MEMORY.md`, and renamed `memory.md` to
    // `.backup` — losing the legacy text from the prompt entirely.
    // After the fix, the error escapes, the runner catches it, logs
    // a single warn, and leaves both files untouched.
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-mem-run-cli-missing-"));
    try {
      const legacyPath = path.join(fresh, "conversations", "memory.md");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      // Same padding strategy as the prior test — get past the
      // 64-byte placeholder threshold so the runner reaches the
      // classifier path, where the CLI-missing error would otherwise
      // have been silently swallowed.
      await writeFile(
        legacyPath,
        ["# Memory", "", "Distilled facts about you and your work.", "", "## Preferences", "- yarn を使う（npm は使わない）", "- Emacs を愛用", ""].join("\n"),
        "utf-8",
      );

      const summarize: Summarize = async () => {
        throw new ClaudeCliNotFoundError();
      };
      await runMemoryMigrationOnce(fresh, { summarize });

      // Legacy file untouched, no .backup created, no typed entries.
      const legacyAfter = await stat(legacyPath).catch(() => null);
      assert.ok(legacyAfter !== null && legacyAfter.isFile(), "legacy file must remain untouched when CLI is missing");
      const backupAfter = await stat(`${legacyPath}.backup`).catch(() => null);
      assert.equal(backupAfter, null, ".backup must NOT be created on CLI-missing");
      const memDir = await stat(path.join(fresh, "conversations", "memory")).catch(() => null);
      assert.equal(memDir, null, "no typed memory dir must be created on CLI-missing");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
