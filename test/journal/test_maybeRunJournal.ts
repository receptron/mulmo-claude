// Coverage for two of the three feature gates inside `maybeRunJournal`:
// the ENOENT-disable latch and the `force` flag that bypasses the
// interval check (#799 PR4).
//
// The third gate — the in-process lock — is intentionally NOT covered
// here. Exercising it deterministically requires holding the first
// call mid-flight while a second runs, which means leaving an
// unresolved Promise around the module-level `running` flag. Any
// failure path before the explicit release leaks `running = true`
// into sibling tests and corrupts their state. The lock itself is
// trivially correct (one synchronous boolean check at the top of
// `maybeRunJournal`); leaving it to manual inspection beats
// flake-prone unit coverage.

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { __resetForTests, maybeRunJournal } from "../../server/workspace/journal/index.js";
import { ClaudeCliNotFoundError, type Summarize } from "../../server/workspace/journal/archivist-cli.js";

async function makeFreshWorkspace(): Promise<string> {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-maybe-run-journal-"));
  // One text event so dailyPass has something to summarise.
  // `parseEntry` only accepts EVENT_TYPES.text / .toolResult — a
  // session with zero parseable events bucketizes empty and the
  // archivist is never called, which would defeat the test.
  const sessionId = "11111111-1111-1111-1111-111111111111";
  const sessionFile = path.join(tmpRoot, "conversations", "chat", `${sessionId}.jsonl`);
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, `${JSON.stringify({ source: "user", type: "text", message: "hi" })}\n`);
  return tmpRoot;
}

describe("maybeRunJournal — feature gates", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    __resetForTests();
    workspaceRoot = await makeFreshWorkspace();
  });

  it("trips the disable latch on ClaudeCliNotFoundError; subsequent calls return without invoking summarize", async () => {
    let summarizeCalls = 0;
    const summarize: Summarize = async () => {
      summarizeCalls++;
      throw new ClaudeCliNotFoundError();
    };

    await maybeRunJournal({ workspaceRoot, summarize, force: true });
    assert.equal(summarizeCalls, 1, "first call should hit summarize and trip the disable latch");

    let secondSummarizeCalls = 0;
    const livelyStub: Summarize = async () => {
      secondSummarizeCalls++;
      return '{"dailySummaryMarkdown":"# x","topicUpdates":[]}';
    };
    await maybeRunJournal({ workspaceRoot, summarize: livelyStub, force: true });
    assert.equal(secondSummarizeCalls, 0, "after disable, summarize must not be reached");
  });

  it("force: true bypasses the interval gate even when timestamps say not-due", async () => {
    // Seed _state.json (canonical path is conversations/summaries/_state.json
    // — see server/utils/files/journal-io.ts) with very recent run
    // timestamps. Without force, the wrapper should short-circuit at
    // isDailyDue / isOptimizationDue and never call summarize.
    const stateDir = path.join(workspaceRoot, "conversations", "summaries");
    await mkdir(stateDir, { recursive: true });
    const recentIso = new Date().toISOString();
    await writeFile(
      path.join(stateDir, "_state.json"),
      JSON.stringify({
        version: 1,
        lastDailyRunAt: recentIso,
        lastOptimizationRunAt: recentIso,
        dailyIntervalHours: 1,
        optimizationIntervalDays: 7,
        processedSessions: {},
        knownTopics: [],
      }),
      "utf-8",
    );

    let summarizeCalls = 0;
    const summarize: Summarize = async () => {
      summarizeCalls++;
      return '{"dailySummaryMarkdown":"# x","topicUpdates":[]}';
    };

    await maybeRunJournal({ workspaceRoot, summarize });
    assert.equal(summarizeCalls, 0, "without force the recent timestamps should gate out");

    await maybeRunJournal({ workspaceRoot, summarize, force: true });
    assert.ok(summarizeCalls >= 1, "force must bypass the interval gate and reach summarize");
  });
});
