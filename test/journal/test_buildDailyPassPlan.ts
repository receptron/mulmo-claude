// Coverage for the `buildDailyPassPlan` extraction (PR2 of #799).
// The full daily pass is integration-tested via session-end smoke
// runs; these checks exercise the planner's two top-level shapes:
// the "no work" early-return and the "work-to-do" plan object. They
// rely on a real tmp workspace because the planner does filesystem
// IO end-to-end (chat dir scan, session jsonl read, topic snapshot).

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { buildDailyPassPlan, type DailyPassDeps } from "../../server/workspace/journal/dailyPass.js";
import { defaultState } from "../../server/workspace/journal/state.js";

// `Summarize` returns a Promise<string>; this stub should never be
// invoked because `buildDailyPassPlan` doesn't call the summarizer
// (it only does the read-only setup). If it ever does, the throw
// surfaces the regression loudly.
const noopSummarize: DailyPassDeps["summarize"] = async () => {
  throw new Error("Summarize should not be called from buildDailyPassPlan");
};

let workspaceRoot: string;

before(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "mulmo-daily-plan-"));
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("buildDailyPassPlan", () => {
  it("returns null when the chat dir does not exist (fresh install)", async () => {
    // Don't create chatDir — listSessionMetas returns empty, no
    // dirty sessions, planner returns null.
    const plan = await buildDailyPassPlan(defaultState(), {
      workspaceRoot,
      summarize: noopSummarize,
      activeSessionIds: new Set(),
    });
    assert.equal(plan, null);
  });

  it("returns null when the chat dir is empty", async () => {
    await mkdir(path.join(workspaceRoot, "conversations", "chat"), { recursive: true });
    const plan = await buildDailyPassPlan(defaultState(), {
      workspaceRoot,
      summarize: noopSummarize,
      activeSessionIds: new Set(),
    });
    assert.equal(plan, null);
  });

  it("returns a plan with workspaceRoot + initialNextState when there's a session to process", async () => {
    // A minimal session jsonl with one user text turn — enough for
    // listSessionMetas to find it and findDirtySessions to flag it
    // as new (empty processedSessions in defaultState).
    const sessionId = "11111111-1111-1111-1111-111111111111";
    const sessionFile = path.join(workspaceRoot, "conversations", "chat", `${sessionId}.jsonl`);
    await mkdir(path.dirname(sessionFile), { recursive: true });
    const event = {
      type: "user_message",
      timestamp: "2026-04-25T01:00:00Z",
      message: "hello",
    };
    await writeFile(sessionFile, `${JSON.stringify(event)}\n`);

    const plan = await buildDailyPassPlan(defaultState(), {
      workspaceRoot,
      summarize: noopSummarize,
      activeSessionIds: new Set(),
    });

    assert.ok(plan, "plan should not be null when there's a dirty session");
    assert.equal(plan.workspaceRoot, workspaceRoot);
    assert.ok(Array.isArray(plan.orderedDays));
    assert.ok(plan.newTopicsSeen instanceof Set);
    assert.equal(plan.initialNextState.knownTopics.length, 0);
    assert.ok(plan.dirtyMetaById.has(sessionId), "session should be in dirtyMetaById");
  });

  it("returns null when the only candidate session is in activeSessionIds (still being written)", async () => {
    // The previous test left a session file in place. Re-run with
    // that session marked active — planner should skip it and find
    // no dirty work.
    const activeId = "11111111-1111-1111-1111-111111111111";
    const plan = await buildDailyPassPlan(defaultState(), {
      workspaceRoot,
      summarize: noopSummarize,
      activeSessionIds: new Set([activeId]),
    });
    assert.equal(plan, null);
  });

  it("returns a plan with empty buckets when every dirty session parses to zero excerpts (regression-sensitive)", async () => {
    // A session jsonl that contains ONLY metadata entries — the
    // parser drops them via `isMetadataEntry`, so the session is
    // "dirty" by mtime but produces zero excerpts. The planner is
    // documented (line 102-108) to NOT short-circuit on this case:
    // it must still snapshot existingTopics and seed
    // initialNextState. If a future "simplification" replaces the
    // helper with `if (perSessionExcerpts.size === 0) return null`,
    // this test fails loudly.
    const sessionId = "22222222-2222-2222-2222-222222222222";
    const sessionFile = path.join(workspaceRoot, "conversations", "chat", `${sessionId}.jsonl`);
    await mkdir(path.dirname(sessionFile), { recursive: true });
    // Two metadata-only lines — both filtered by isMetadataEntry,
    // so `parseJsonlEvents` returns []. No text/tool_result entries
    // means dayBuckets stays empty.
    const meta1 = { type: "session_meta", roleId: "general" };
    const meta2 = { type: "claude_session_id", id: "claude-abc" };
    await writeFile(sessionFile, `${JSON.stringify(meta1)}\n${JSON.stringify(meta2)}\n`);

    // Seed the state with deliberately UNSORTED topics so the
    // `knownTopics: [...newTopicsSeen].sort()` line in the planner
    // is observably the cause of the post-condition. Without this
    // seeding the assertion is vacuous (empty list is trivially
    // sorted) — Codex iter-2 flagged the original version of this
    // test for exactly that.
    const seededState = {
      ...defaultState(),
      knownTopics: ["zeta", "alpha", "kappa"],
    };

    const plan = await buildDailyPassPlan(seededState, {
      workspaceRoot,
      summarize: noopSummarize,
      activeSessionIds: new Set(),
    });

    assert.ok(plan, "plan should be non-null even when all dirty sessions parse to zero excerpts");
    assert.equal(plan.dayBuckets.size, 0, "dayBuckets should be empty");
    assert.equal(plan.perSessionExcerpts.size, 0, "perSessionExcerpts should be empty");
    assert.equal(plan.orderedDays.length, 0, "no days to process");
    // initialNextState must be normalised — `knownTopics` arrives
    // unsorted (zeta/alpha/kappa) and must come back sorted.
    assert.deepEqual(plan.initialNextState.knownTopics, ["alpha", "kappa", "zeta"]);
    // The dirty session must still be tracked in dirtyMetaById so
    // anything downstream could (in principle) mark it processed.
    assert.ok(plan.dirtyMetaById.has(sessionId), "metadata-only session is still tracked as dirty");
  });
});
