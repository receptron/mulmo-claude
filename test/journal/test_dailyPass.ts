import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  entryToExcerpt,
  extractArtifactPaths,
  parseEntry,
  buildDayBuckets,
  normalizeTopicAction,
  parseArchivistOutput,
  computeJustCompletedSessions,
  advanceJournalState,
  parseJsonlEvents,
  bucketParsedEvents,
  type ParsedEntry,
} from "../../server/journal/dailyPass.js";
import type {
  SessionExcerpt,
  ExistingTopicSnapshot,
} from "../../server/journal/archivist.js";
import type { SessionFileMeta } from "../../server/journal/diff.js";
import type { JournalState } from "../../server/journal/state.js";

describe("entryToExcerpt", () => {
  it("converts a text entry", () => {
    const out = entryToExcerpt({
      source: "user",
      type: "text",
      message: "hello",
    });
    assert.deepEqual(out, {
      source: "user",
      type: "text",
      content: "hello",
    });
  });

  it("truncates very long text messages", () => {
    const longMsg = "x".repeat(2000);
    const out = entryToExcerpt({
      source: "assistant",
      type: "text",
      message: longMsg,
    });
    assert.ok(out);
    assert.ok(out!.content.length < longMsg.length);
    assert.ok(out!.content.endsWith("…"));
  });

  it("converts a tool_result entry using toolName + title", () => {
    const out = entryToExcerpt({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "generateImage",
        title: "a sunset",
        message: "full message",
      },
    });
    assert.ok(out);
    assert.match(out!.content, /generateImage: a sunset/);
  });

  it("falls back to message when title is missing", () => {
    const out = entryToExcerpt({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "searchX",
        message: "got 10 results",
      },
    });
    assert.ok(out);
    assert.match(out!.content, /searchX: got 10 results/);
  });

  it("falls back to '(no message)' when both title and message are missing", () => {
    const out = entryToExcerpt({
      source: "tool",
      type: "tool_result",
      result: { toolName: "weird" },
    });
    assert.ok(out);
    assert.match(out!.content, /weird: \(no message\)/);
  });

  it("returns null for unrecognised entry types", () => {
    assert.equal(
      entryToExcerpt({ source: "user", type: "mystery", message: "x" }),
      null,
    );
  });

  it("returns null for text entries with no message", () => {
    assert.equal(entryToExcerpt({ source: "user", type: "text" }), null);
  });

  it("returns null for tool_result with non-object result", () => {
    assert.equal(
      entryToExcerpt({ source: "tool", type: "tool_result", result: "str" }),
      null,
    );
  });

  it("handles missing source/type by using 'unknown'", () => {
    const out = entryToExcerpt({ message: "hi", type: "text" });
    assert.ok(out);
    assert.equal(out!.source, "unknown");
  });
});

describe("extractArtifactPaths", () => {
  it("returns [] for text entries", () => {
    assert.deepEqual(
      extractArtifactPaths({ source: "user", type: "text", message: "hi" }),
      [],
    );
  });

  it("extracts data.filePath from a tool_result", () => {
    const paths = extractArtifactPaths({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "presentMulmoScript",
        data: { filePath: "stories/foo.json" },
      },
    });
    assert.deepEqual(paths, ["stories/foo.json"]);
  });

  it("synthesises a wiki page path from manageWiki + pageName", () => {
    const paths = extractArtifactPaths({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "manageWiki",
        data: { action: "view", pageName: "refactoring" },
      },
    });
    assert.deepEqual(paths, ["wiki/pages/refactoring.md"]);
  });

  it("extracts from presentHtml via data.filePath", () => {
    const paths = extractArtifactPaths({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "presentHtml",
        data: { filePath: "HTMLs/report.html" },
      },
    });
    assert.deepEqual(paths, ["HTMLs/report.html"]);
  });

  it("rejects absolute paths in filePath", () => {
    const paths = extractArtifactPaths({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "presentHtml",
        data: { filePath: "/etc/passwd" },
      },
    });
    assert.deepEqual(paths, []);
  });

  it("rejects parent-escape paths in filePath", () => {
    const paths = extractArtifactPaths({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "presentHtml",
        data: { filePath: "../../etc/passwd" },
      },
    });
    assert.deepEqual(paths, []);
  });

  it("rejects scheme-looking paths in filePath", () => {
    const paths = extractArtifactPaths({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "foo",
        data: { filePath: "https://example.com/x" },
      },
    });
    assert.deepEqual(paths, []);
  });

  it("returns [] when data is missing", () => {
    assert.deepEqual(
      extractArtifactPaths({
        source: "tool",
        type: "tool_result",
        result: { toolName: "presentHtml" },
      }),
      [],
    );
  });

  it("returns [] for non-tool_result entries", () => {
    assert.deepEqual(
      extractArtifactPaths({
        type: "other",
        result: { data: { filePath: "x" } },
      }),
      [],
    );
  });
});

describe("parseEntry", () => {
  it("returns excerpt plus artifactPaths for a tool_result", () => {
    const parsed = parseEntry({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "presentMulmoScript",
        title: "story about a cat",
        data: { filePath: "stories/cat.json" },
      },
    });
    assert.ok(parsed);
    assert.match(
      parsed!.excerpt.content,
      /presentMulmoScript: story about a cat/,
    );
    assert.deepEqual(parsed!.artifactPaths, ["stories/cat.json"]);
  });

  it("returns empty artifactPaths for a text entry", () => {
    const parsed = parseEntry({ source: "user", type: "text", message: "hi" });
    assert.ok(parsed);
    assert.deepEqual(parsed!.artifactPaths, []);
  });

  it("returns null for entries that don't produce an excerpt", () => {
    assert.equal(parseEntry({ source: "x", type: "mystery" }), null);
  });
});

// ── Pure helpers introduced by the cognitive-complexity refactor ──

function mkExcerpt(sessionId: string, content: string): SessionExcerpt {
  return {
    sessionId,
    roleId: "general",
    events: [{ source: "user", type: "text", content }],
    artifactPaths: [],
  };
}

describe("buildDayBuckets", () => {
  it("returns empty plan for empty input", () => {
    const plan = buildDayBuckets(new Map());
    assert.equal(plan.dayBuckets.size, 0);
    assert.equal(plan.sessionToDays.size, 0);
  });

  it("groups a single session's per-date excerpts into dayBuckets", () => {
    const perSession = new Map([
      [
        "s1",
        new Map([
          ["2026-04-10", mkExcerpt("s1", "hello")],
          ["2026-04-11", mkExcerpt("s1", "later")],
        ]),
      ],
    ]);
    const plan = buildDayBuckets(perSession);
    assert.equal(plan.dayBuckets.size, 2);
    assert.equal(plan.dayBuckets.get("2026-04-10")!.length, 1);
    assert.equal(plan.dayBuckets.get("2026-04-11")!.length, 1);
    assert.deepEqual([...plan.sessionToDays.get("s1")!].sort(), [
      "2026-04-10",
      "2026-04-11",
    ]);
  });

  it("merges multiple sessions that share a date into the same bucket", () => {
    const perSession = new Map([
      ["s1", new Map([["2026-04-10", mkExcerpt("s1", "a")]])],
      ["s2", new Map([["2026-04-10", mkExcerpt("s2", "b")]])],
    ]);
    const plan = buildDayBuckets(perSession);
    assert.equal(plan.dayBuckets.size, 1);
    assert.equal(plan.dayBuckets.get("2026-04-10")!.length, 2);
    assert.equal(plan.sessionToDays.get("s1")!.has("2026-04-10"), true);
    assert.equal(plan.sessionToDays.get("s2")!.has("2026-04-10"), true);
  });

  it("tracks the full day-set for a session that spans many dates", () => {
    const byDate = new Map<string, SessionExcerpt>();
    for (const d of ["2026-04-10", "2026-04-11", "2026-04-12"]) {
      byDate.set(d, mkExcerpt("s1", d));
    }
    const plan = buildDayBuckets(new Map([["s1", byDate]]));
    assert.equal(plan.sessionToDays.get("s1")!.size, 3);
  });
});

describe("normalizeTopicAction", () => {
  it("canonicalises the slug (slugify)", () => {
    const out = normalizeTopicAction(
      { slug: "Video Generation!", action: "create", content: "body" },
      [],
    );
    assert.equal(out.slug, "video-generation");
  });

  it("promotes append-to-missing into create", () => {
    const out = normalizeTopicAction(
      { slug: "new-topic", action: "append", content: "body" },
      [],
    );
    assert.equal(out.action, "create");
  });

  it("keeps append when the topic already exists", () => {
    const existing: ExistingTopicSnapshot[] = [
      { slug: "existing", content: "old body" },
    ];
    const out = normalizeTopicAction(
      { slug: "existing", action: "append", content: "new body" },
      existing,
    );
    assert.equal(out.action, "append");
  });

  it("leaves create and rewrite actions untouched", () => {
    const existing: ExistingTopicSnapshot[] = [
      { slug: "existing", content: "old" },
    ];
    const created = normalizeTopicAction(
      { slug: "new", action: "create", content: "x" },
      existing,
    );
    const rewritten = normalizeTopicAction(
      { slug: "existing", action: "rewrite", content: "y" },
      existing,
    );
    assert.equal(created.action, "create");
    assert.equal(rewritten.action, "rewrite");
  });

  it("rewrites workspace-absolute links in the content", () => {
    // /wiki/foo.md is an absolute workspace link — should become a
    // relative link from the topic file's location.
    const out = normalizeTopicAction(
      {
        slug: "topic",
        action: "create",
        content: "see [foo](/wiki/foo.md)",
      },
      [],
    );
    // The new link must no longer start with a slash and must still
    // reach wiki/foo.md somehow. We assert both in a loose way so
    // the test survives a future rewrite-algorithm tweak.
    assert.doesNotMatch(out.content, /\(\/wiki/);
    assert.match(out.content, /wiki\/foo\.md/);
  });
});

describe("parseArchivistOutput", () => {
  const validOutput = {
    dailySummaryMarkdown: "# 2026-04-12\n- something happened",
    topicUpdates: [
      { slug: "refactoring", action: "append", content: "more progress" },
    ],
  };

  it("returns the parsed output for a well-formed JSON fence", () => {
    const raw =
      "Some preface\n```json\n" + JSON.stringify(validOutput) + "\n```";
    const out = parseArchivistOutput(raw);
    assert.ok(out);
    assert.equal(out!.dailySummaryMarkdown, validOutput.dailySummaryMarkdown);
    assert.equal(out!.topicUpdates.length, 1);
  });

  it("returns null for missing JSON fence", () => {
    assert.equal(parseArchivistOutput("just prose, no json"), null);
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseArchivistOutput("```json\n{ not json\n```"), null);
  });

  it("returns null when required fields are missing", () => {
    const raw = "```json\n" + JSON.stringify({ topicUpdates: [] }) + "\n```";
    assert.equal(parseArchivistOutput(raw), null);
  });

  it("returns null when topicUpdates has the wrong shape", () => {
    const raw =
      "```json\n" +
      JSON.stringify({
        dailySummaryMarkdown: "# x",
        topicUpdates: [{ slug: "t" }], // missing action / content
      }) +
      "\n```";
    assert.equal(parseArchivistOutput(raw), null);
  });
});

describe("computeJustCompletedSessions", () => {
  function makeMeta(id: string, mtimeMs = 100): SessionFileMeta {
    return { id, mtimeMs };
  }

  it("marks a session complete when this day is its only remaining one", () => {
    const sessionToDays = new Map([["s1", new Set(["2026-04-10"])]]);
    const dirtyMetaById = new Map([["s1", makeMeta("s1")]]);
    const excerpts = [mkExcerpt("s1", "hi")];
    const completed = computeJustCompletedSessions(
      "2026-04-10",
      excerpts,
      sessionToDays,
      dirtyMetaById,
    );
    assert.deepEqual(
      completed.map((m) => m.id),
      ["s1"],
    );
    // sessionToDays should be empty after the mutation.
    assert.equal(sessionToDays.has("s1"), false);
  });

  it("does not mark a session complete while other days are still pending", () => {
    const sessionToDays = new Map([
      ["s1", new Set(["2026-04-10", "2026-04-11"])],
    ]);
    const dirtyMetaById = new Map([["s1", makeMeta("s1")]]);
    const excerpts = [mkExcerpt("s1", "first day")];
    const completed = computeJustCompletedSessions(
      "2026-04-10",
      excerpts,
      sessionToDays,
      dirtyMetaById,
    );
    assert.equal(completed.length, 0);
    assert.deepEqual(
      [...sessionToDays.get("s1")!],
      ["2026-04-11"], // 2026-04-10 removed
    );
  });

  it("processes multiple excerpts in one call", () => {
    const sessionToDays = new Map([
      ["s1", new Set(["2026-04-10"])],
      ["s2", new Set(["2026-04-10", "2026-04-11"])],
    ]);
    const dirtyMetaById = new Map([
      ["s1", makeMeta("s1")],
      ["s2", makeMeta("s2")],
    ]);
    const excerpts = [mkExcerpt("s1", "a"), mkExcerpt("s2", "b")];
    const completed = computeJustCompletedSessions(
      "2026-04-10",
      excerpts,
      sessionToDays,
      dirtyMetaById,
    );
    // Only s1 completes; s2 still has 2026-04-11 pending.
    assert.deepEqual(
      completed.map((m) => m.id),
      ["s1"],
    );
    assert.equal(sessionToDays.has("s1"), false);
    assert.deepEqual([...sessionToDays.get("s2")!], ["2026-04-11"]);
  });

  it("silently skips sessions missing from sessionToDays", () => {
    const sessionToDays = new Map<string, Set<string>>();
    const dirtyMetaById = new Map([["ghost", { id: "ghost", mtimeMs: 1 }]]);
    const completed = computeJustCompletedSessions(
      "2026-04-10",
      [mkExcerpt("ghost", "x")],
      sessionToDays,
      dirtyMetaById,
    );
    assert.equal(completed.length, 0);
  });

  it("silently skips sessions missing from dirtyMetaById", () => {
    // Defensive-path coverage: session is in sessionToDays (so its
    // day-set gets drained) but has no meta — must not crash and
    // must not emit an undefined entry.
    const sessionToDays = new Map([["orphan", new Set(["2026-04-10"])]]);
    const dirtyMetaById = new Map<string, SessionFileMeta>();
    const completed = computeJustCompletedSessions(
      "2026-04-10",
      [mkExcerpt("orphan", "x")],
      sessionToDays,
      dirtyMetaById,
    );
    assert.equal(completed.length, 0);
    assert.equal(sessionToDays.has("orphan"), false);
  });
});

describe("advanceJournalState", () => {
  function baseState(): JournalState {
    return {
      version: 1,
      lastDailyRunAt: null,
      lastOptimizationRunAt: null,
      dailyIntervalHours: 1,
      optimizationIntervalDays: 7,
      processedSessions: {},
      knownTopics: [],
    };
  }

  it("upserts just-completed sessions into processedSessions", () => {
    const out = advanceJournalState(
      baseState(),
      [{ id: "s1", mtimeMs: 1234 }],
      new Set(),
    );
    assert.deepEqual(out.processedSessions["s1"], { lastMtimeMs: 1234 });
  });

  it("sorts knownTopics alphabetically", () => {
    const out = advanceJournalState(
      baseState(),
      [],
      new Set(["banana", "apple", "cherry"]),
    );
    assert.deepEqual(out.knownTopics, ["apple", "banana", "cherry"]);
  });

  it("preserves unrelated state fields unchanged", () => {
    const prev = {
      ...baseState(),
      lastDailyRunAt: "2026-04-12T00:00:00.000Z",
      lastOptimizationRunAt: "2026-04-10T00:00:00.000Z",
      dailyIntervalHours: 2,
      optimizationIntervalDays: 3,
    };
    const out = advanceJournalState(prev, [], new Set());
    assert.equal(out.lastDailyRunAt, prev.lastDailyRunAt);
    assert.equal(out.lastOptimizationRunAt, prev.lastOptimizationRunAt);
    assert.equal(out.dailyIntervalHours, 2);
    assert.equal(out.optimizationIntervalDays, 3);
  });

  it("does not mutate the input state in place", () => {
    const prev = baseState();
    advanceJournalState(prev, [{ id: "s1", mtimeMs: 99 }], new Set(["t1"]));
    assert.deepEqual(prev.processedSessions, {});
    assert.deepEqual(prev.knownTopics, []);
  });
});

describe("parseJsonlEvents", () => {
  it("returns an empty array for empty input", () => {
    assert.deepEqual(parseJsonlEvents("", 10), []);
  });

  it("skips blank lines and malformed JSON", () => {
    const raw = [
      "",
      "not json",
      JSON.stringify({ source: "user", type: "text", message: "hi" }),
      "{",
      "",
    ].join("\n");
    const out = parseJsonlEvents(raw, 10);
    assert.equal(out.length, 1);
    assert.equal(out[0].excerpt.content, "hi");
  });

  it("skips session_meta and claude_session_id entries", () => {
    const raw = [
      JSON.stringify({ type: "session_meta", roleId: "x" }),
      JSON.stringify({ type: "claude_session_id", id: "abc" }),
      JSON.stringify({ source: "user", type: "text", message: "real" }),
    ].join("\n");
    const out = parseJsonlEvents(raw, 10);
    assert.equal(out.length, 1);
    assert.equal(out[0].excerpt.content, "real");
  });

  it("honours the maxEvents cap", () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(
        JSON.stringify({ source: "user", type: "text", message: `m${i}` }),
      );
    }
    const out = parseJsonlEvents(lines.join("\n"), 5);
    assert.equal(out.length, 5);
    assert.equal(out[0].excerpt.content, "m0");
    assert.equal(out[4].excerpt.content, "m4");
  });

  it("returns excerpts with artifact paths populated via parseEntry", () => {
    const raw = JSON.stringify({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "presentMulmoScript",
        title: "story",
        data: { filePath: "stories/x.json" },
      },
    });
    const out = parseJsonlEvents(raw, 10);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].artifactPaths, ["stories/x.json"]);
  });

  it("skips non-object JSON values (null, arrays, primitives)", () => {
    // JSON.parse will happily return any JSON value. The original
    // inline code trusted the result, which meant a `null` line
    // would crash the whole session at `entry.type === ...`.
    // parseJsonlLine's guard should collapse each of these into
    // the same "skip this line" path.
    const raw = [
      "null",
      "[1,2,3]",
      '"just a string"',
      "42",
      "true",
      JSON.stringify({ source: "user", type: "text", message: "real" }),
    ].join("\n");
    const out = parseJsonlEvents(raw, 10);
    assert.equal(out.length, 1);
    assert.equal(out[0].excerpt.content, "real");
  });
});

describe("bucketParsedEvents", () => {
  function mkParsed(content: string, artifacts: string[] = []): ParsedEntry {
    return {
      excerpt: { source: "user", type: "text", content },
      artifactPaths: artifacts,
    };
  }

  it("returns an empty map for no events", () => {
    const out = bucketParsedEvents([], "s1", "general", "2026-04-12");
    assert.equal(out.size, 0);
  });

  it("creates one bucket at the fallback date with all events", () => {
    const out = bucketParsedEvents(
      [mkParsed("a"), mkParsed("b")],
      "s1",
      "general",
      "2026-04-12",
    );
    assert.equal(out.size, 1);
    const bucket = out.get("2026-04-12")!;
    assert.equal(bucket.sessionId, "s1");
    assert.equal(bucket.roleId, "general");
    assert.equal(bucket.events.length, 2);
  });

  it("accumulates unique artifact paths across events", () => {
    const out = bucketParsedEvents(
      [
        mkParsed("a", ["stories/one.json"]),
        mkParsed("b", ["stories/two.json"]),
        mkParsed("c", ["stories/one.json"]), // duplicate
      ],
      "s1",
      "general",
      "2026-04-12",
    );
    const bucket = out.get("2026-04-12")!;
    assert.deepEqual(bucket.artifactPaths, [
      "stories/one.json",
      "stories/two.json",
    ]);
  });
});
