// Unit tests for `decorateMessageForCli` (#2134). The Claude Code CLI
// resolves a slash command deterministically only when the message
// STARTS with `/name`; a decoration pushed in front of it drops skill
// selection back to the model guessing from descriptions. These tests
// pin the "never displace a leading `/`" policy: skip the journal
// pointer on command turns, append (not prepend) file markers there,
// and keep the original prepend behaviour for open-question turns.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { decorateMessageForCli } from "../../../server/agent/messageDecorate.ts";
import { WORKSPACE_FILES } from "../../../server/workspace/paths.js";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "decorate-cli-test-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function writeJournalIndex(): void {
  const abs = join(workspace, WORKSPACE_FILES.summariesIndex);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, "# Workspace Journal\n\n- refactoring\n");
}

function decorate(message: string, opts?: { attachedFilePaths?: string[]; resumed?: boolean }): string {
  return decorateMessageForCli({
    message,
    workspaceDir: workspace,
    attachedFilePaths: opts?.attachedFilePaths ?? [],
    resumed: opts?.resumed ?? false,
  });
}

describe("decorateMessageForCli (#2134)", () => {
  it("prepends the journal pointer for an open-question first turn (unchanged)", () => {
    writeJournalIndex();
    const result = decorate("What did I do last week?");
    assert.ok(result.startsWith("<journal-context>"), "open question should still get the pointer");
    assert.ok(result.includes("What did I do last week?"));
  });

  it("does NOT prepend the journal pointer on a command turn — message stays slash-first", () => {
    writeJournalIndex();
    const result = decorate("/todo-malaysia id=42 done");
    assert.ok(result.startsWith("/todo-malaysia"), `command must stay at position 0, got: ${JSON.stringify(result)}`);
    assert.ok(!result.includes("<journal-context>"), "a command turn must not carry the journal pointer");
  });

  it("appends the file marker after a command body so the slash stays first", () => {
    writeJournalIndex();
    const result = decorate("/todo-malaysia id=42 done", { attachedFilePaths: ["data/attachments/2026/07/a.png"] });
    assert.ok(result.startsWith("/todo-malaysia id=42 done"), "slash command must remain at position 0");
    assert.ok(result.endsWith("[Attached file: data/attachments/2026/07/a.png]"), "marker should be appended after the body");
    assert.ok(!result.includes("<journal-context>"));
  });

  it("prepends the file marker for a non-command turn (unchanged)", () => {
    const result = decorate("combine these", { attachedFilePaths: ["artifacts/images/2026/07/x.png"] });
    assert.ok(result.startsWith("[Attached file: artifacts/images/2026/07/x.png]"));
    assert.ok(result.endsWith("combine these"));
  });

  it("never prepends the journal pointer on a resumed turn (unchanged)", () => {
    writeJournalIndex();
    const result = decorate("open question on turn 2", { resumed: true });
    assert.equal(result, "open question on turn 2");
  });

  it("keeps a resumed command turn slash-first", () => {
    writeJournalIndex();
    const result = decorate("/todo-list add milk", { resumed: true });
    assert.equal(result, "/todo-list add milk");
  });

  it("returns the raw message when there is no journal and no attachment", () => {
    const result = decorate("plain hello");
    assert.equal(result, "plain hello");
  });

  it("treats a leading space before the slash as a non-command (matches the CLI's position-0 check)", () => {
    writeJournalIndex();
    const result = decorate(" /todo-list add milk");
    assert.ok(result.startsWith("<journal-context>"), "a space-prefixed slash is not a deterministic command, so the pointer still applies");
  });
});
