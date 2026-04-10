import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// `server/workspace.ts` reads `os.homedir()` at the moment its module
// body executes. We must override `HOME` (and `USERPROFILE` for
// Windows compatibility) BEFORE the module is imported, then resolve
// the modules dynamically. Static top-level imports of these modules
// would lock in the real $HOME and break test isolation.
let testHome: string;
let chatTestDir: string;
let indexer: typeof import("../../server/chat-index/indexer.js");
let summarizer: typeof import("../../server/chat-index/summarizer.js");

before(async () => {
  testHome = mkdtempSync(join(tmpdir(), "mc-chat-index-test-"));
  process.env.HOME = testHome;
  process.env.USERPROFILE = testHome;
  chatTestDir = join(testHome, "mulmoclaude", "chat");
  mkdirSync(chatTestDir, { recursive: true });

  indexer = await import("../../server/chat-index/indexer.js");
  summarizer = await import("../../server/chat-index/summarizer.js");
});

describe("computeJsonlSha256", () => {
  it("is deterministic for the same content", () => {
    const a = "line1\nline2\n";
    assert.equal(
      indexer.computeJsonlSha256(a),
      indexer.computeJsonlSha256(a),
    );
  });

  it("differs for different content", () => {
    assert.notEqual(
      indexer.computeJsonlSha256("a"),
      indexer.computeJsonlSha256("b"),
    );
  });

  it("emits a 64-char hex string", () => {
    const sha = indexer.computeJsonlSha256("anything");
    assert.match(sha, /^[0-9a-f]{64}$/);
  });
});

describe("extractText", () => {
  it("keeps user / assistant text turns and joins them", () => {
    const jsonl = [
      JSON.stringify({ source: "user", type: "text", message: "hello" }),
      JSON.stringify({ source: "assistant", type: "text", message: "hi there" }),
    ].join("\n");
    const text = summarizer.extractText(jsonl);
    assert.match(text, /\[user\] hello/);
    assert.match(text, /\[assistant\] hi there/);
  });

  it("filters tool_result entries", () => {
    const jsonl = [
      JSON.stringify({ source: "user", type: "text", message: "do it" }),
      JSON.stringify({
        source: "tool",
        type: "tool_result",
        result: { foo: "bar" },
      }),
      JSON.stringify({ source: "assistant", type: "text", message: "done" }),
    ].join("\n");
    const text = summarizer.extractText(jsonl);
    assert.doesNotMatch(text, /foo/);
    assert.doesNotMatch(text, /tool_result/);
    assert.match(text, /do it/);
    assert.match(text, /done/);
  });

  it("skips malformed lines", () => {
    const jsonl = [
      "not json at all",
      JSON.stringify({ source: "user", type: "text", message: "hello" }),
      "{broken",
    ].join("\n");
    const text = summarizer.extractText(jsonl);
    assert.match(text, /hello/);
  });

  it("truncates very long single messages", () => {
    const long = "x".repeat(2000);
    const jsonl = JSON.stringify({
      source: "user",
      type: "text",
      message: long,
    });
    const text = summarizer.extractText(jsonl);
    assert.ok(text.length < 2000);
    assert.ok(text.includes("…"));
  });
});

describe("truncate", () => {
  it("passes short text through unchanged", () => {
    assert.equal(summarizer.truncate("short text"), "short text");
  });

  it("returns head + tail with separator when text is too long", () => {
    const long = "a".repeat(3000) + "MIDDLE_MARKER" + "b".repeat(7000);
    const t = summarizer.truncate(long);
    assert.ok(t.length < long.length);
    assert.ok(t.includes("…"));
    // Head should still contain a's, tail should contain b's
    assert.ok(t.startsWith("a"));
    assert.ok(t.endsWith("b"));
  });
});

describe("validateSummaryResult", () => {
  it("accepts a well-formed object", () => {
    const r = summarizer.validateSummaryResult({
      title: "T",
      summary: "S",
      keywords: ["a", "b"],
    });
    assert.deepEqual(r, { title: "T", summary: "S", keywords: ["a", "b"] });
  });

  it("defaults missing fields to empty", () => {
    const r = summarizer.validateSummaryResult({});
    assert.deepEqual(r, { title: "", summary: "", keywords: [] });
  });

  it("filters non-string keywords out", () => {
    const r = summarizer.validateSummaryResult({
      title: "x",
      summary: "y",
      keywords: ["a", 1, null, "b", true],
    });
    assert.deepEqual(r.keywords, ["a", "b"]);
  });

  it("throws on non-objects", () => {
    assert.throws(() => summarizer.validateSummaryResult(null));
    assert.throws(() => summarizer.validateSummaryResult("string"));
    assert.throws(() => summarizer.validateSummaryResult(42));
  });
});

describe("parseClaudeJsonResult", () => {
  it("extracts structured_output from a successful claude json envelope", () => {
    const stdout = JSON.stringify({
      type: "result",
      is_error: false,
      structured_output: {
        title: "X",
        summary: "Y",
        keywords: ["a", "b"],
      },
    });
    const r = summarizer.parseClaudeJsonResult(stdout);
    assert.equal(r.title, "X");
    assert.equal(r.summary, "Y");
    assert.deepEqual(r.keywords, ["a", "b"]);
  });

  it("rejects is_error: true", () => {
    const stdout = JSON.stringify({
      is_error: true,
      result: "something went wrong",
    });
    assert.throws(
      () => summarizer.parseClaudeJsonResult(stdout),
      /something went wrong/,
    );
  });

  it("throws on missing structured_output", () => {
    const stdout = JSON.stringify({ type: "result", is_error: false });
    assert.throws(() => summarizer.parseClaudeJsonResult(stdout));
  });

  it("throws on unparseable stdout", () => {
    assert.throws(() => summarizer.parseClaudeJsonResult("not json"));
  });
});

describe("manifest round-trip", () => {
  it("readManifest returns empty default when no manifest exists", async () => {
    const m = await indexer.readManifest();
    // Either empty (first run) or carries entries from previous tests.
    assert.equal(m.version, 1);
    assert.ok(Array.isArray(m.entries));
  });

  it("writeManifest then readManifest round-trips", async () => {
    const sample = {
      version: 1 as const,
      entries: [
        {
          id: "round-trip-test",
          roleId: "general",
          startedAt: "2026-04-10T00:00:00Z",
          sourceSha256: "abc123",
          sourceLines: 5,
          indexedAt: "2026-04-10T01:00:00Z",
          title: "Test",
          summary: "Test summary",
          keywords: ["a", "b"],
        },
      ],
    };
    await indexer.writeManifest(sample);
    const back = await indexer.readManifest();
    const found = back.entries.find((e) => e.id === "round-trip-test");
    assert.ok(found);
    assert.equal(found?.title, "Test");
  });
});

describe("findStaleSessions", () => {
  it("flags an unknown session as stale", async () => {
    const id = `stale-test-${Date.now()}`;
    writeFileSync(
      join(chatTestDir, `${id}.jsonl`),
      JSON.stringify({
        source: "user",
        type: "text",
        message: "hi",
      }) + "\n",
    );
    const stale = await indexer.findStaleSessions();
    assert.ok(stale.includes(id), `expected ${id} to be stale`);
  });

  it("does not flag a session whose hash matches the manifest", async () => {
    const id = `fresh-test-${Date.now()}`;
    writeFileSync(
      join(chatTestDir, `${id}.jsonl`),
      JSON.stringify({
        source: "user",
        type: "text",
        message: "hi",
      }) + "\n",
    );
    writeFileSync(
      join(chatTestDir, `${id}.json`),
      JSON.stringify({ roleId: "general", startedAt: "2026-04-10T00:00:00Z" }),
    );
    await indexer.indexOne(id, {
      summarize: async () => ({
        title: "Stub",
        summary: "Stub",
        keywords: ["k"],
      }),
    });
    const stale = await indexer.findStaleSessions();
    assert.ok(!stale.includes(id));
  });

  it("re-flags a session whose content changed", async () => {
    const id = `changing-test-${Date.now()}`;
    const file = join(chatTestDir, `${id}.jsonl`);
    writeFileSync(
      file,
      JSON.stringify({ source: "user", type: "text", message: "v1" }) + "\n",
    );
    await indexer.indexOne(id, {
      summarize: async () => ({
        title: "v1",
        summary: "v1",
        keywords: [],
      }),
    });
    // Append a new turn — the sha changes.
    writeFileSync(
      file,
      JSON.stringify({ source: "user", type: "text", message: "v1" }) +
        "\n" +
        JSON.stringify({ source: "assistant", type: "text", message: "v2" }) +
        "\n",
    );
    const stale = await indexer.findStaleSessions();
    assert.ok(stale.includes(id));
  });
});

describe("indexOne", () => {
  it("creates a per-session file and adds the entry to the manifest", async () => {
    const id = `index-one-${Date.now()}`;
    writeFileSync(
      join(chatTestDir, `${id}.jsonl`),
      JSON.stringify({
        source: "user",
        type: "text",
        message: "test",
      }) + "\n",
    );
    writeFileSync(
      join(chatTestDir, `${id}.json`),
      JSON.stringify({ roleId: "general", startedAt: "2026-04-10T00:00:00Z" }),
    );

    const entry = await indexer.indexOne(id, {
      summarize: async () => ({
        title: "Indexed Title",
        summary: "Indexed summary",
        keywords: ["k1", "k2"],
      }),
    });

    assert.ok(entry);
    assert.equal(entry?.title, "Indexed Title");
    assert.equal(entry?.id, id);
    assert.equal(entry?.roleId, "general");

    const manifest = await indexer.readManifest();
    const found = manifest.entries.find((e) => e.id === id);
    assert.ok(found);
    assert.equal(found?.title, "Indexed Title");
    assert.deepEqual(found?.keywords, ["k1", "k2"]);
  });

  it("returns null when summarize throws", async () => {
    const id = `failing-${Date.now()}`;
    writeFileSync(
      join(chatTestDir, `${id}.jsonl`),
      JSON.stringify({
        source: "user",
        type: "text",
        message: "x",
      }) + "\n",
    );
    const result = await indexer.indexOne(id, {
      summarize: async () => {
        throw new Error("simulated failure");
      },
    });
    assert.equal(result, null);
  });

  it("falls back to default roleId when meta is missing", async () => {
    const id = `no-meta-${Date.now()}`;
    writeFileSync(
      join(chatTestDir, `${id}.jsonl`),
      JSON.stringify({
        source: "user",
        type: "text",
        message: "x",
      }) + "\n",
    );
    // Note: no .json metadata file written
    const entry = await indexer.indexOne(id, {
      summarize: async () => ({
        title: "x",
        summary: "x",
        keywords: [],
      }),
    });
    assert.ok(entry);
    assert.equal(entry?.roleId, "general");
  });
});

describe("indexStale", () => {
  it("respects the limit", async () => {
    // Plant several stale sessions and assert only `limit` get processed.
    const ts = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = `batch-${ts}-${i}`;
      ids.push(id);
      writeFileSync(
        join(chatTestDir, `${id}.jsonl`),
        JSON.stringify({
          source: "user",
          type: "text",
          message: `msg ${i}`,
        }) + "\n",
      );
    }
    const processed = await indexer.indexStale({
      limit: 2,
      deps: {
        summarize: async () => ({
          title: "x",
          summary: "x",
          keywords: [],
        }),
      },
    });
    assert.equal(processed, 2);
  });
});
