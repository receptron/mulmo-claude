// Crash-recovery integration test for `runDailyPass` (#799 PR4).
//
// `dailyPass.ts` writes _state.json after each successful day via
// `persistStateAfterDay`. Comments around the day loop claim
// per-day checkpointing makes the pass crash-safe — if the process
// dies mid-loop, the next run picks up only the days that hadn't
// committed.
//
// Until now nothing in the test suite exercised that claim. This
// file simulates a mid-pass failure by injecting a Summarize stub
// that succeeds for the first day's call and throws for subsequent
// ones, then re-runs with a working stub and asserts the second
// day catches up cleanly.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { runDailyPass } from "../../server/workspace/journal/dailyPass.js";
import { defaultState, parseState } from "../../server/workspace/journal/state.js";
import type { Summarize } from "../../server/workspace/journal/archivist-cli.js";

let workspaceRoot: string;
const SESSION_DAY1 = "11111111-1111-1111-1111-111111111111";
const SESSION_DAY2 = "22222222-2222-2222-2222-222222222222";

// dailyPass buckets a session by its file mtime (`stat.mtimeMs` →
// `toIsoDate`), not by per-event timestamps. Force two days by
// utimes-ing the session files explicitly to different dates.
const DAY_ONE_DATE = "2026-04-23";
const DAY_TWO_DATE = "2026-04-24";
const dayOneEpoch = new Date(`${DAY_ONE_DATE}T12:00:00Z`).getTime() / 1000;
const dayTwoEpoch = new Date(`${DAY_TWO_DATE}T12:00:00Z`).getTime() / 1000;

before(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "mulmo-daily-crash-recovery-"));
  const chatDir = path.join(workspaceRoot, "conversations", "chat");
  await mkdir(chatDir, { recursive: true });

  // `parseEntry` only accepts EVENT_TYPES.text / .toolResult.
  const dayOneFile = path.join(chatDir, `${SESSION_DAY1}.jsonl`);
  const dayTwoFile = path.join(chatDir, `${SESSION_DAY2}.jsonl`);
  await writeFile(dayOneFile, `${JSON.stringify({ source: "user", type: "text", message: "day one" })}\n`);
  await writeFile(dayTwoFile, `${JSON.stringify({ source: "user", type: "text", message: "day two" })}\n`);
  await utimes(dayOneFile, dayOneEpoch, dayOneEpoch);
  await utimes(dayTwoFile, dayTwoEpoch, dayTwoEpoch);
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

async function readPersistedState(): Promise<ReturnType<typeof defaultState>> {
  // Canonical state path lives at conversations/summaries/_state.json
  // — see server/utils/files/journal-io.ts. journal-io's `summariesRoot`
  // joins workspaceRoot + WORKSPACE_DIRS.summaries
  // (= "conversations/summaries").
  const statePath = path.join(workspaceRoot, "conversations", "summaries", "_state.json");
  try {
    const text = await readFile(statePath, "utf-8");
    return parseState(JSON.parse(text));
  } catch {
    return defaultState();
  }
}

describe("runDailyPass — crash recovery", () => {
  it("a failing day is checkpointed as skipped; the next run picks it up cleanly", async () => {
    // Phase 1 — Summarize that succeeds for the first call,
    // throws for the second. `callSummarizeForDay` swallows
    // non-ENOENT errors and returns null, so the day is marked
    // skipped rather than the whole pass crashing. The session-
    // ingest checkpoint for day 1 still commits via persistStateAfterDay.
    let dailySummarizeCalls = 0;
    // Match by system prompt header — DAILY_SYSTEM_PROMPT starts with
    // "You are the journal archivist", memoryExtractor's prompt starts
    // with "You are a personal-fact extractor". Day 1 succeeds, day 2
    // throws; memory always succeeds with an empty result so nothing
    // gets appended — keeps the test focused on per-day checkpoint
    // behaviour and the day count assertion stays unambiguous.
    const stubFlaky: Summarize = async (systemPrompt) => {
      if (systemPrompt.startsWith("You are the journal archivist")) {
        dailySummarizeCalls++;
        if (dailySummarizeCalls === 1) {
          return '{"dailySummaryMarkdown":"# day 1","topicUpdates":[]}';
        }
        throw new Error("simulated mid-pass crash");
      }
      return '{"facts":[]}';
    };

    const { result: firstResult } = await runDailyPass(defaultState(), {
      workspaceRoot,
      summarize: stubFlaky,
      activeSessionIds: new Set(),
    });

    assert.equal(dailySummarizeCalls, 2, "daily summarize should have been called for both days");
    assert.deepEqual(firstResult.daysTouched, [DAY_ONE_DATE], "only day-one should land");
    assert.equal(firstResult.skipped.length, 1, "day-two should be marked skipped");
    assert.equal(firstResult.skipped[0]?.date, DAY_TWO_DATE);
    assert.match(firstResult.skipped[0]?.reason ?? "", /summarize/i);

    // The day-1 session was ingested before the day-2 failure, so
    // its checkpoint must be on disk. Day-2's session ID must not
    // appear in `processedSessions` — that's the resumability
    // invariant the journal's per-day commit is meant to guarantee.
    const persisted = await readPersistedState();
    const processedIds = Object.keys(persisted.processedSessions);
    assert.ok(processedIds.includes(SESSION_DAY1), "day-one session must be marked processed");
    assert.ok(!processedIds.includes(SESSION_DAY2), "day-two session must NOT be marked processed");

    // Phase 2 — re-run with a healthy stub. Day-one is already
    // committed so its session shouldn't be in the dirty set;
    // only day-two reaches the new stub.
    let secondDailyCalls = 0;
    const stubHealthy: Summarize = async (systemPrompt) => {
      if (systemPrompt.startsWith("You are the journal archivist")) {
        secondDailyCalls++;
        return '{"dailySummaryMarkdown":"# day 2","topicUpdates":[]}';
      }
      // Memory extractor — return empty so nothing's appended.
      return '{"facts":[]}';
    };
    const { result } = await runDailyPass(persisted, {
      workspaceRoot,
      summarize: stubHealthy,
      activeSessionIds: new Set(),
    });

    assert.equal(secondDailyCalls, 1, "only day-two should reach the second-run daily summarize");
    assert.deepEqual(result.daysTouched, [DAY_TWO_DATE], "exactly day-two should land");
    assert.deepEqual(result.skipped, [], "no day should be marked skipped on the resume");
  });
});
