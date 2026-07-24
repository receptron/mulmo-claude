import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectSessionEntriesNewestFirst, findLastSessionEntry, type SessionJsonlEntry } from "../../server/utils/sessionJsonl.ts";

// Both call sites in production shape their pick the same way: match on
// `type`, then project. These stand in for `claudeSessionId` (find) and
// `text` (collect).
const pickId = (entry: SessionJsonlEntry): string | undefined => (entry.type === "claude_session_id" && typeof entry.id === "string" ? entry.id : undefined);

const pickMessage = (entry: SessionJsonlEntry): string | undefined => (entry.type === "text" && typeof entry.message === "string" ? entry.message : undefined);

// A pick keyed off `type` cannot tell a plain object from a number/string/array
// — none of those carry a `type`. `length` they DO carry, so this pick is what
// makes the `isRecord` narrowing observable from the outside.
const pickLength = (entry: SessionJsonlEntry): number | undefined => (typeof entry.length === "number" ? entry.length : undefined);

const jsonlOf = (...entries: unknown[]): string => entries.map((entry) => JSON.stringify(entry)).join("\n");

describe("findLastSessionEntry", () => {
  it("returns undefined for an empty string", () => {
    assert.equal(findLastSessionEntry("", pickId), undefined);
  });

  it("returns undefined when the content is only blank lines", () => {
    assert.equal(findLastSessionEntry("\n\n\n", pickId), undefined);
  });

  it("returns undefined when the content is only whitespace lines", () => {
    assert.equal(findLastSessionEntry("   \n\t\n  \t  ", pickId), undefined);
  });

  it("skips a malformed JSON line between valid ones", () => {
    const jsonl = [JSON.stringify({ type: "text", message: "hi" }), "{not json at all", JSON.stringify({ type: "claude_session_id", id: "abc" })].join("\n");
    assert.equal(findLastSessionEntry(jsonl, pickId), "abc");
  });

  it("returns undefined when no line has a matching type", () => {
    const jsonl = jsonlOf({ type: "text", message: "one" }, { type: "tool_result", ok: true }, { type: "session_meta", roleId: "general" });
    assert.equal(findLastSessionEntry(jsonl, pickId), undefined);
  });

  it("finds a match sitting on the last line", () => {
    const jsonl = jsonlOf({ type: "text", message: "one" }, { type: "claude_session_id", id: "last" });
    assert.equal(findLastSessionEntry(jsonl, pickId), "last");
  });

  it("finds a match sitting on the first line", () => {
    const jsonl = jsonlOf({ type: "claude_session_id", id: "first" }, { type: "text", message: "one" }, { type: "text", message: "two" });
    assert.equal(findLastSessionEntry(jsonl, pickId), "first");
  });

  it("prefers the newest match when several lines match", () => {
    const jsonl = jsonlOf(
      { type: "claude_session_id", id: "oldest" },
      { type: "claude_session_id", id: "middle" },
      { type: "claude_session_id", id: "newest" },
    );
    assert.equal(findLastSessionEntry(jsonl, pickId), "newest");
  });

  it("tolerates a trailing newline (jsonl is always terminated)", () => {
    const jsonl = `${jsonlOf({ type: "claude_session_id", id: "abc" })}\n`;
    assert.equal(findLastSessionEntry(jsonl, pickId), "abc");
  });

  it("skips a matching entry whose projected field is missing", () => {
    const jsonl = jsonlOf({ type: "claude_session_id", id: "kept" }, { type: "claude_session_id" });
    assert.equal(findLastSessionEntry(jsonl, pickId), "kept");
  });

  // --- the isRecord guard -----------------------------------------
  // These lines are valid JSON but not objects. The guard's contract is that
  // `pick` only ever receives a plain object, so a pick may index it without
  // re-checking. A pick that keys off `type` can't tell the difference (a
  // number/string/array has no `type`), so the tests that actually pin the
  // guard are the two below that read a property a non-object DOES carry.

  it("skips a line that parses to a number", () => {
    const jsonl = ["42", JSON.stringify({ type: "claude_session_id", id: "abc" })].join("\n");
    assert.equal(findLastSessionEntry(jsonl, pickId), "abc");
  });

  it("skips a line that parses to a string", () => {
    const jsonl = ['"claude_session_id"', JSON.stringify({ type: "claude_session_id", id: "abc" })].join("\n");
    assert.equal(findLastSessionEntry(jsonl, pickId), "abc");
  });

  it("skips a line that parses to an array", () => {
    const jsonl = ['[{"type":"claude_session_id","id":"from-array"}]', JSON.stringify({ type: "claude_session_id", id: "abc" })].join("\n");
    assert.equal(findLastSessionEntry(jsonl, pickId), "abc");
  });

  it("skips lines that parse to null / true", () => {
    const jsonl = ["null", "true", JSON.stringify({ type: "claude_session_id", id: "abc" })].join("\n");
    assert.equal(findLastSessionEntry(jsonl, pickId), "abc");
  });

  it("returns undefined when every line is a non-object", () => {
    assert.equal(findLastSessionEntry(['"a string"', "7", "[1,2,3]", "null"].join("\n"), pickId), undefined);
  });

  it("does not hand pick an array, even when the array carries the property pick reads", () => {
    const jsonl = ['["text","text"]', JSON.stringify({ type: "claude_session_id", id: "abc" })].join("\n");
    assert.equal(findLastSessionEntry(jsonl, pickLength), undefined);
  });

  it("does not hand pick a string, even though a string carries `length`", () => {
    assert.equal(findLastSessionEntry('"abcd"', pickLength), undefined);
  });
});

describe("collectSessionEntriesNewestFirst", () => {
  it("returns an empty array for an empty string", () => {
    assert.deepEqual(collectSessionEntriesNewestFirst("", pickMessage), []);
  });

  it("returns an empty array when the content is only blank lines", () => {
    assert.deepEqual(collectSessionEntriesNewestFirst("\n\n\n", pickMessage), []);
  });

  it("returns an empty array when no line has a matching type", () => {
    const jsonl = jsonlOf({ type: "tool_result", ok: true }, { type: "session_meta", roleId: "general" });
    assert.deepEqual(collectSessionEntriesNewestFirst(jsonl, pickMessage), []);
  });

  it("returns matches newest-first", () => {
    const jsonl = jsonlOf({ type: "text", message: "one" }, { type: "text", message: "two" }, { type: "text", message: "three" });
    assert.deepEqual(collectSessionEntriesNewestFirst(jsonl, pickMessage), ["three", "two", "one"]);
  });

  it("keeps a match on the first line last, and a match on the last line first", () => {
    const jsonl = jsonlOf({ type: "text", message: "first" }, { type: "tool_result", ok: true }, { type: "text", message: "last" });
    assert.deepEqual(collectSessionEntriesNewestFirst(jsonl, pickMessage), ["last", "first"]);
  });

  it("skips a malformed JSON line between valid ones", () => {
    const jsonl = [JSON.stringify({ type: "text", message: "one" }), "{broken", JSON.stringify({ type: "text", message: "two" })].join("\n");
    assert.deepEqual(collectSessionEntriesNewestFirst(jsonl, pickMessage), ["two", "one"]);
  });

  it("projects the full record, not just a field", () => {
    const jsonl = jsonlOf({ type: "text", message: "hi", source: "user" }, { type: "text", message: "yo" });
    const messages = collectSessionEntriesNewestFirst(jsonl, (entry) =>
      entry.type === "text" && typeof entry.message === "string"
        ? { source: typeof entry.source === "string" && entry.source.length > 0 ? entry.source : "unknown", text: entry.message }
        : undefined,
    );
    assert.deepEqual(messages, [
      { source: "unknown", text: "yo" },
      { source: "user", text: "hi" },
    ]);
  });

  // --- the isRecord guard -----------------------------------------

  it("skips lines that parse to a number, a string, or an array", () => {
    const jsonl = ["3.14", '"text"', '[{"type":"text","message":"from-array"}]', JSON.stringify({ type: "text", message: "kept" })].join("\n");
    assert.deepEqual(collectSessionEntriesNewestFirst(jsonl, pickMessage), ["kept"]);
  });

  it("returns an empty array when every line is a non-object", () => {
    assert.deepEqual(collectSessionEntriesNewestFirst(["0", '""', "[]", "false"].join("\n"), pickMessage), []);
  });

  it("hands pick plain objects only — no primitive, no array", () => {
    const seen: SessionJsonlEntry[] = [];
    const jsonl = ['"a string"', "42", "[1,2,3]", "null", "true", JSON.stringify({ type: "text", message: "ok" })].join("\n");
    collectSessionEntriesNewestFirst(jsonl, (entry) => {
      seen.push(entry);
      return undefined;
    });
    assert.deepEqual(seen, [{ type: "text", message: "ok" }]);
  });

  it("does not hand pick an array or a string, even though both carry `length`", () => {
    const jsonl = ['["text","text"]', '"abcd"', JSON.stringify({ type: "text", message: "kept" })].join("\n");
    assert.deepEqual(collectSessionEntriesNewestFirst(jsonl, pickLength), []);
  });
});
