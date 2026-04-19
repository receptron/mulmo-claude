import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TRANSCRIPT_MAX_CHARS,
  buildTranscriptPreamble,
  isStaleSessionError,
} from "../../server/agent/resumeFailover.ts";
import { EVENT_TYPES } from "../../src/types/events.ts";

// Shape matches what `server/api/routes/agent.ts` appends to the session
// jsonl. Kept close to the production writer so drift breaks the
// tests loudly.
function jsonlLine(source: "user" | "assistant", message: string): string {
  return JSON.stringify({ source, type: EVENT_TYPES.text, message });
}

function jsonlFrom(
  entries: { source: "user" | "assistant"; message: string }[],
): string {
  return entries.map((e) => jsonlLine(e.source, e.message)).join("\n") + "\n";
}

describe("isStaleSessionError", () => {
  it("matches the CLI's stderr phrase exactly", () => {
    const line =
      "No conversation found with session ID: cf40e522-19e5-4ad7-aa35-cd85d6b88331";
    assert.equal(isStaleSessionError(line), true);
  });

  it("matches even when wrapped by other stderr output", () => {
    const msg =
      "Error: no resume\nNo conversation found with session ID: abc\nmore context";
    assert.equal(isStaleSessionError(msg), true);
  });

  it("rejects unrelated errors so a fail-over doesn't swallow real bugs", () => {
    assert.equal(isStaleSessionError("Network unreachable"), false);
    assert.equal(isStaleSessionError("claude exited with code 1"), false);
    assert.equal(isStaleSessionError(""), false);
  });

  it("does not over-match on a partial phrase (avoid false positives)", () => {
    // Defensive: a message that mentions "session" / "ID" but not
    // the full phrase must not trigger fail-over.
    assert.equal(isStaleSessionError("session ID invalid"), false);
    assert.equal(isStaleSessionError("No conversation is available"), false);
  });
});

describe("buildTranscriptPreamble — basic formatting", () => {
  it("returns empty string for empty input", () => {
    assert.equal(buildTranscriptPreamble(""), "");
  });

  it("returns empty string when no text entries exist", () => {
    // A jsonl containing only tool events must not yield a preamble,
    // since there's nothing human-readable to replay.
    const jsonl =
      JSON.stringify({
        source: "tool",
        type: EVENT_TYPES.toolResult,
        result: {},
      }) + "\n";
    assert.equal(buildTranscriptPreamble(jsonl), "");
  });

  it("formats a simple user/assistant transcript chronologically", () => {
    const jsonl = jsonlFrom([
      { source: "user", message: "hello" },
      { source: "assistant", message: "hi there" },
      { source: "user", message: "what's up?" },
      { source: "assistant", message: "not much" },
    ]);
    const preamble = buildTranscriptPreamble(jsonl);
    // Header + footer framing
    assert.match(preamble, /Continuing from an earlier session/);
    assert.match(preamble, /End of prior transcript/);
    // Chronological order (oldest first)
    const userPos = preamble.indexOf("User: hello");
    const assistantPos = preamble.indexOf("Assistant: hi there");
    const laterPos = preamble.indexOf("User: what's up?");
    assert.ok(userPos < assistantPos);
    assert.ok(assistantPos < laterPos);
  });
});

describe("buildTranscriptPreamble — filtering", () => {
  it("skips tool_call / tool_result / tool_call_result entries", () => {
    const lines = [
      jsonlLine("user", "first user msg"),
      JSON.stringify({
        source: "assistant",
        type: EVENT_TYPES.toolCall,
        toolUseId: "x",
        toolName: "y",
        args: {},
      }),
      JSON.stringify({
        source: "tool",
        type: EVENT_TYPES.toolResult,
        result: {},
      }),
      JSON.stringify({
        source: "assistant",
        type: EVENT_TYPES.toolCallResult,
        toolUseId: "x",
        content: "…",
      }),
      jsonlLine("assistant", "answer text"),
    ];
    const preamble = buildTranscriptPreamble(lines.join("\n") + "\n");
    assert.match(preamble, /User: first user msg/);
    assert.match(preamble, /Assistant: answer text/);
    assert.doesNotMatch(preamble, /toolUseId/);
    assert.doesNotMatch(preamble, /tool_call/);
  });

  it("skips malformed lines without throwing", () => {
    const jsonl =
      "not json\n" +
      jsonlLine("user", "still works") +
      "\n" +
      "{also broken\n" +
      jsonlLine("assistant", "reply") +
      "\n";
    const preamble = buildTranscriptPreamble(jsonl);
    assert.match(preamble, /User: still works/);
    assert.match(preamble, /Assistant: reply/);
  });

  it("ignores entries with a non-user/assistant source", () => {
    const lines = [
      JSON.stringify({
        source: "system",
        type: EVENT_TYPES.text,
        message: "system note",
      }),
      jsonlLine("user", "kept"),
    ];
    const preamble = buildTranscriptPreamble(lines.join("\n") + "\n");
    assert.doesNotMatch(preamble, /system note/);
    assert.match(preamble, /User: kept/);
  });

  it("ignores entries whose message field is missing or empty", () => {
    const lines = [
      JSON.stringify({ source: "user", type: EVENT_TYPES.text, message: "" }),
      JSON.stringify({ source: "user", type: EVENT_TYPES.text }),
      jsonlLine("user", "real one"),
    ];
    const preamble = buildTranscriptPreamble(lines.join("\n") + "\n");
    assert.match(preamble, /User: real one/);
    // Empty strings shouldn't produce bare "User: " lines
    assert.doesNotMatch(preamble, /^User: $/m);
  });
});

describe("buildTranscriptPreamble — truncation", () => {
  it("keeps all turns when under the limit", () => {
    const jsonl = jsonlFrom([
      { source: "user", message: "a" },
      { source: "assistant", message: "b" },
    ]);
    const preamble = buildTranscriptPreamble(jsonl, { maxChars: 1000 });
    assert.doesNotMatch(preamble, /earlier turns omitted/);
    assert.match(preamble, /User: a/);
    assert.match(preamble, /Assistant: b/);
  });

  it("drops oldest turns when the total exceeds maxChars", () => {
    const big = "x".repeat(500);
    const jsonl = jsonlFrom([
      { source: "user", message: `old-${big}` },
      { source: "assistant", message: `older-reply-${big}` },
      { source: "user", message: "recent-user" },
      { source: "assistant", message: "recent-reply" },
    ]);
    // maxChars that fits the two recent turns but not the older pair
    const preamble = buildTranscriptPreamble(jsonl, { maxChars: 100 });
    assert.match(preamble, /earlier turns omitted/);
    assert.match(preamble, /User: recent-user/);
    assert.match(preamble, /Assistant: recent-reply/);
    assert.doesNotMatch(preamble, /User: old-/);
  });

  it("returns empty if even the single latest turn exceeds the budget", () => {
    const jsonl = jsonlFrom([{ source: "user", message: "a".repeat(10_000) }]);
    assert.equal(buildTranscriptPreamble(jsonl, { maxChars: 10 }), "");
  });

  it("uses DEFAULT_TRANSCRIPT_MAX_CHARS when opts.maxChars is omitted", () => {
    // Confirm the constant is wired as the default — a regression in
    // that wiring would silently change the prompt budget.
    const smallJsonl = jsonlFrom([{ source: "user", message: "hi" }]);
    const defaulted = buildTranscriptPreamble(smallJsonl);
    const explicit = buildTranscriptPreamble(smallJsonl, {
      maxChars: DEFAULT_TRANSCRIPT_MAX_CHARS,
    });
    assert.equal(defaulted, explicit);
  });
});
