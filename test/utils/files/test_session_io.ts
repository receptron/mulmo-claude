import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  createSessionMeta,
  readSessionMeta,
  writeSessionMeta,
  updateHasUnread,
  backfillFirstUserMessage,
  setClaudeSessionId,
  clearClaudeSessionId,
  appendSessionLine,
  readSessionJsonl,
  statSessionJsonlSize,
  truncateSessionJsonl,
} from "../../../server/utils/files/session-io.js";
import { WORKSPACE_DIRS } from "../../../server/workspace/paths.js";

let root: string;

before(() => {
  root = mkdtempSync(path.join(tmpdir(), "session-io-test-"));
  // Create the chat dir
  mkdirSync(path.join(root, WORKSPACE_DIRS.chat), { recursive: true });
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readSessionMeta", () => {
  it("returns null for non-existent session", async () => {
    assert.equal(await readSessionMeta("nonexistent", root), null);
  });

  it("returns null for corrupt JSON (not crash)", async () => {
    const chatDir = path.join(root, WORKSPACE_DIRS.chat);
    writeFileSync(path.join(chatDir, "corrupt.json"), "{broken");
    assert.equal(await readSessionMeta("corrupt", root), null);
  });

  it("round-trips with writeSessionMeta", async () => {
    await writeSessionMeta("rw-test", { roleId: "general" }, root);
    const meta = await readSessionMeta("rw-test", root);
    assert.equal(meta?.roleId, "general");
  });
});

describe("createSessionMeta", () => {
  it("creates meta with roleId, startedAt, firstUserMessage", async () => {
    await createSessionMeta("create-test", "office", "hello", root);
    const meta = await readSessionMeta("create-test", root);
    assert.equal(meta?.roleId, "office");
    assert.equal(meta?.firstUserMessage, "hello");
    assert.ok(meta?.startedAt);
  });

  it("creates parent dir if missing", async () => {
    const freshRoot = mkdtempSync(path.join(tmpdir(), "session-io-nodir-"));
    // Don't pre-create chat dir
    await createSessionMeta("nodir-test", "general", "hi", freshRoot);
    const meta = await readSessionMeta("nodir-test", freshRoot);
    assert.equal(meta?.roleId, "general");
    rmSync(freshRoot, { recursive: true, force: true });
  });
});

describe("updateHasUnread", () => {
  it("sets hasUnread on existing meta", async () => {
    await writeSessionMeta("unread-test", { roleId: "general" }, root);
    await updateHasUnread("unread-test", true, root);
    const meta = await readSessionMeta("unread-test", root);
    assert.equal(meta?.hasUnread, true);
  });

  it("no-ops when session meta does not exist", async () => {
    // Should not throw
    await updateHasUnread("ghost", false, root);
  });
});

describe("backfillFirstUserMessage", () => {
  it("backfills when missing", async () => {
    await writeSessionMeta("backfill-test", { roleId: "general" }, root);
    await backfillFirstUserMessage("backfill-test", "first msg", root);
    const meta = await readSessionMeta("backfill-test", root);
    assert.equal(meta?.firstUserMessage, "first msg");
  });

  it("does not overwrite when already set", async () => {
    await writeSessionMeta("backfill-noop", { roleId: "general", firstUserMessage: "original" }, root);
    await backfillFirstUserMessage("backfill-noop", "replacement", root);
    const meta = await readSessionMeta("backfill-noop", root);
    assert.equal(meta?.firstUserMessage, "original");
  });
});

describe("setClaudeSessionId / clearClaudeSessionId", () => {
  it("sets and clears claudeSessionId", async () => {
    await writeSessionMeta("claude-test", { roleId: "general" }, root);
    await setClaudeSessionId("claude-test", "cs-123", root);
    let meta = await readSessionMeta("claude-test", root);
    assert.equal(meta?.claudeSessionId, "cs-123");

    await clearClaudeSessionId("claude-test", root);
    meta = await readSessionMeta("claude-test", root);
    assert.equal(meta?.claudeSessionId, undefined);
    assert.equal(meta?.roleId, "general"); // other fields preserved
  });
});

describe("appendSessionLine", () => {
  it("appends lines with trailing newline", async () => {
    await appendSessionLine("append-test", '{"a":1}', root);
    await appendSessionLine("append-test", '{"b":2}', root);
    const raw = await readSessionJsonl("append-test", root);
    assert.ok(raw);
    const lines = raw.split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), { a: 1 });
    assert.deepEqual(JSON.parse(lines[1]), { b: 2 });
  });

  it("normalizes missing trailing newline", async () => {
    await appendSessionLine("nl-test", "line-without-nl", root);
    await appendSessionLine("nl-test", "line-with-nl\n", root);
    const raw = await readSessionJsonl("nl-test", root);
    assert.ok(raw);
    // Both should end up as separate lines
    const lines = raw.split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    assert.equal(lines[0], "line-without-nl");
    assert.equal(lines[1], "line-with-nl");
  });

  it("does not double-newline when caller already includes \\n", async () => {
    await appendSessionLine("double-nl", "data\n", root);
    const raw = await readSessionJsonl("double-nl", root);
    assert.ok(raw);
    assert.equal(raw, "data\n");
    // NOT "data\n\n"
  });
});

describe("readSessionJsonl", () => {
  it("returns null for non-existent session", async () => {
    assert.equal(await readSessionJsonl("no-jsonl", root), null);
  });
});

// statSessionJsonlSize / truncateSessionJsonl are the persistence
// half of the Stop-button "this turn never happened" flow (#822).
// `statSessionJsonlSize` snapshots the byte boundary right before
// the user message is appended; `truncateSessionJsonl` rolls the
// file back to that boundary when the run was cancelled.

describe("statSessionJsonlSize", () => {
  it("returns 0 for a session with no jsonl on disk yet (ENOENT swallowed)", async () => {
    // First-turn cancel hits this branch: the file doesn't exist
    // until the first appendSessionLine succeeds. Returning 0
    // (instead of throwing) lets the cancel rollback path treat
    // 'truncate to 0' = 'delete contents' uniformly.
    assert.equal(await statSessionJsonlSize("never-existed", root), 0);
  });

  it("returns the current byte size after appends", async () => {
    await appendSessionLine("size-test", JSON.stringify({ source: "user", message: "hi" }), root);
    const after1 = await statSessionJsonlSize("size-test", root);
    assert.ok(after1 > 0, `expected size > 0, got ${after1}`);
    await appendSessionLine("size-test", JSON.stringify({ source: "user", message: "hi again" }), root);
    const after2 = await statSessionJsonlSize("size-test", root);
    assert.ok(after2 > after1, `expected ${after2} > ${after1}`);
  });
});

describe("truncateSessionJsonl", () => {
  it("rolls a file back to a recorded byte offset (cancel happy path)", async () => {
    // Simulate the agent route's flow: snapshot size → append user
    // message → run "fails" via cancel → truncate back.
    const sessionId = "truncate-happy";
    const sizeBefore = await statSessionJsonlSize(sessionId, root);
    assert.equal(sizeBefore, 0);
    await appendSessionLine(sessionId, JSON.stringify({ source: "user", message: "doomed" }), root);
    await truncateSessionJsonl(sessionId, sizeBefore, root);
    const raw = await readSessionJsonl(sessionId, root);
    assert.equal(raw, "");
  });

  it("preserves earlier turns when called mid-history (multi-turn cancel)", async () => {
    // Turn 1 lands; turn 2 gets cancelled. Truncating to the
    // turn-2 boundary must keep turn 1's bytes intact.
    const sessionId = "truncate-multiturn";
    await appendSessionLine(sessionId, JSON.stringify({ source: "user", message: "turn 1" }), root);
    await appendSessionLine(sessionId, JSON.stringify({ source: "assistant", message: "ok" }), root);
    const turnTwoBoundary = await statSessionJsonlSize(sessionId, root);
    await appendSessionLine(sessionId, JSON.stringify({ source: "user", message: "turn 2 doomed" }), root);
    await truncateSessionJsonl(sessionId, turnTwoBoundary, root);
    const raw = (await readSessionJsonl(sessionId, root)) ?? "";
    assert.equal(raw.includes("turn 1"), true);
    assert.equal(raw.includes("ok"), true);
    assert.equal(raw.includes("doomed"), false);
  });

  it("is idempotent — already-shorter file is a no-op", async () => {
    // Defensive: if the cancel path runs after some other process
    // already truncated (or the file never grew past the boundary),
    // truncate must NOT extend the file with zero bytes.
    const sessionId = "truncate-idempotent";
    await appendSessionLine(sessionId, "short\n", root);
    const sizeBefore = await statSessionJsonlSize(sessionId, root);
    await truncateSessionJsonl(sessionId, sizeBefore + 1000, root);
    const sizeAfter = await statSessionJsonlSize(sessionId, root);
    assert.equal(sizeAfter, sizeBefore, "must not grow the file");
  });

  it("no-ops on a non-existent file (ENOENT swallowed)", async () => {
    // First-turn cancel where the user message append failed before
    // the file was created — truncate must not throw.
    await truncateSessionJsonl("never-existed-truncate", 0, root);
    // Sanity: file still doesn't exist; readSessionJsonl returns null.
    assert.equal(await readSessionJsonl("never-existed-truncate", root), null);
  });
});
