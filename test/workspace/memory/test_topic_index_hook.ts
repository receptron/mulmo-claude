// Unit tests for the topic-index auto-regen hook (#1032).
//
// The path predicate is the load-bearing piece: it decides which
// `publishFileChange` events trigger a regenerate vs become no-ops.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isTopicFilePath, maybeRegenerateTopicIndex, TOPIC_INDEX_RELATIVE_PATH } from "../../../server/workspace/memory/topic-index-hook.js";

describe("memory/topic-index-hook — isTopicFilePath", () => {
  it("matches files inside each of the four type subdirs", () => {
    assert.equal(isTopicFilePath("conversations/memory/preference/dev.md"), true);
    assert.equal(isTopicFilePath("conversations/memory/interest/music.md"), true);
    assert.equal(isTopicFilePath("conversations/memory/fact/travel.md"), true);
    assert.equal(isTopicFilePath("conversations/memory/reference/tasks.md"), true);
  });

  it("rejects MEMORY.md and other root-level files (the index itself, not a topic)", () => {
    // The index file IS the regen target — regenerating because it
    // changed would loop. Exclusion is mandatory.
    assert.equal(isTopicFilePath("conversations/memory/MEMORY.md"), false);
    assert.equal(isTopicFilePath("conversations/memory/note.md"), false);
  });

  it("rejects unrelated workspace paths", () => {
    assert.equal(isTopicFilePath("conversations/chat/abc.jsonl"), false);
    assert.equal(isTopicFilePath("data/wiki/pages/foo.md"), false);
    assert.equal(isTopicFilePath("artifacts/documents/2026/04/note.md"), false);
    assert.equal(isTopicFilePath(""), false);
  });

  it("rejects non-markdown files inside the topic subdirs", () => {
    assert.equal(isTopicFilePath("conversations/memory/fact/travel.json"), false);
    assert.equal(isTopicFilePath("conversations/memory/preference/dev"), false);
  });

  it("rejects nested paths under a type subdir (layout is flat)", () => {
    // The topic format does not allow nesting under a type. A path
    // like `interest/foo/bar.md` is malformed; not regenerating
    // for it avoids reinforcing the wrong shape.
    assert.equal(isTopicFilePath("conversations/memory/interest/foo/bar.md"), false);
  });

  it("rejects atomic-backup and archived dirs (residual from prior migrations)", () => {
    // After a swap, the prior atomic layout lives under
    // `.atomic-backup/<ts>/` inside memory/. Edits there must not
    // trigger regen — those files are not topic-format and the
    // backup is intentionally untouched.
    assert.equal(isTopicFilePath("conversations/memory/.atomic-backup/2026-05-01-1228/preference_yarn.md"), false);
    assert.equal(isTopicFilePath("conversations/memory/.archived/preference/dev.md"), false);
  });

  it("rejects type-prefixed paths that just happen to match the prefix string", () => {
    // The prefix check requires `conversations/memory/<type>/`,
    // not `conversations/memory<something>/`.
    assert.equal(isTopicFilePath("conversations/memory_old/preference/dev.md"), false);
    assert.equal(isTopicFilePath("data/conversations/memory/fact/travel.md"), false);
  });

  it("rejects basenames that fail the topic-slug shape gate", () => {
    // Same contract the writer enforces (isSafeTopicSlug):
    // lowercase alnum + `-` only, length 1–60. A malformed file
    // dropped manually under a type subdir won't load anyway, so
    // regen would just churn for an entry that's still missing
    // from the index.
    assert.equal(isTopicFilePath("conversations/memory/fact/Egypt Trip.md"), false); // space
    assert.equal(isTopicFilePath("conversations/memory/fact/Travel.md"), false); // uppercase
    assert.equal(isTopicFilePath("conversations/memory/fact/-leading.md"), false); // leading -
    assert.equal(isTopicFilePath("conversations/memory/fact/trailing-.md"), false); // trailing -
    assert.equal(isTopicFilePath(`conversations/memory/fact/${"a".repeat(61)}.md`), false); // too long
  });

  it("rejects absolute paths and backslash-using inputs (defensive — caller is expected POSIX-relative)", () => {
    // `publishFileChange` already normalises to POSIX before
    // calling, but a future caller routing the wrong shape in
    // shouldn't trigger filesystem work outside the memory root.
    assert.equal(isTopicFilePath("/conversations/memory/fact/travel.md"), false);
    assert.equal(isTopicFilePath("conversations\\memory\\fact\\travel.md"), false);
    assert.equal(isTopicFilePath("conversations/memory/fact\\travel.md"), false);
  });
});

describe("memory/topic-index-hook — maybeRegenerateTopicIndex", () => {
  it("exports the canonical relative path of the index it rebuilds", () => {
    // The relative path is the contract `publishFileChange` uses
    // to emit a follow-up change event for the index file. Pinning
    // it as a constant keeps caller and predicate aligned.
    assert.equal(TOPIC_INDEX_RELATIVE_PATH, "conversations/memory/MEMORY.md");
  });

  it("returns false (no regen ran) for paths that fail the predicate", async () => {
    // `publishFileChange` keys its follow-up index event off this
    // boolean — callers MUST be able to distinguish "the predicate
    // rejected the path" from "regen happened". We exercise the
    // negative path here because it doesn't touch disk.
    assert.equal(await maybeRegenerateTopicIndex("data/wiki/pages/foo.md"), false);
    assert.equal(await maybeRegenerateTopicIndex("conversations/memory/MEMORY.md"), false);
    assert.equal(await maybeRegenerateTopicIndex(""), false);
  });
});
