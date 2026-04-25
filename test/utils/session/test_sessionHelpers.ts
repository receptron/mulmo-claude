import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { createEmptySession } from "../../../src/utils/session/sessionFactory.js";
import { applyTextEvent, beginUserTurn, undoLastTurn } from "../../../src/utils/session/sessionHelpers.js";

// `undoLastTurn` is the client-side half of the Stop button's
// "this turn never happened" UX (#821). Pre-#821 the Stop button
// killed the agent process and surfaced "[Error] claude exited with
// code 143" while leaving the just-sent user message stranded in
// chat. Now Stop pulls the user message back into the input form
// and removes any partial assistant output.

function pushAssistantTextResult(text: string) {
  return {
    uuid: `assistant-${text}`,
    toolName: "text-response",
    message: text,
    title: "Assistant",
    data: { text, role: "assistant", transportKind: "text-rest" },
  } as unknown as ToolResultComplete;
}

describe("undoLastTurn", () => {
  it("returns null restoredText when the session has no turns yet", () => {
    const session = createEmptySession("s1", "general");
    const result = undoLastTurn(session);
    assert.equal(result.restoredText, null);
    assert.equal(session.toolResults.length, 0);
    assert.equal(session.runStartIndex, 0);
  });

  it("removes the last user message and returns its text (first-turn cancel)", () => {
    // The original symptom: user sends the very first message, hits
    // Stop, and the chat is left with a stranded user bubble + scary
    // error. After undo the chat is empty again and the text comes
    // back in restoredText so the caller can write it to the input.
    const session = createEmptySession("s1", "general");
    beginUserTurn(session, "Hello, please help me with X");
    assert.equal(session.toolResults.length, 1);
    assert.equal(session.runStartIndex, 1);

    const { restoredText } = undoLastTurn(session);
    assert.equal(restoredText, "Hello, please help me with X");
    assert.equal(session.toolResults.length, 0);
    assert.equal(session.runStartIndex, 0);
  });

  it("removes partial assistant output produced before the cancel", () => {
    // Cancel after the agent has already streamed some output —
    // we treat the entire turn as if it never happened (matching
    // ChatGPT/Discord stop-generating semantics), so the partial
    // assistant text disappears too.
    const session = createEmptySession("s1", "general");
    beginUserTurn(session, "explain reactivity");
    applyTextEvent(session, "Reactivity in Vue is...", "assistant");
    assert.equal(session.toolResults.length, 2);

    const { restoredText } = undoLastTurn(session);
    assert.equal(restoredText, "explain reactivity");
    assert.equal(session.toolResults.length, 0);
  });

  it("preserves earlier turns — only the last one is undone", () => {
    // A multi-turn chat where the user cancels turn 2: turn 1's
    // user+assistant exchange must stay untouched.
    const session = createEmptySession("s1", "general");
    beginUserTurn(session, "hi");
    applyTextEvent(session, "Hello! How can I help?", "assistant");
    const turnOneLength = session.toolResults.length; // 2

    beginUserTurn(session, "tell me more");
    applyTextEvent(session, "Sure, here's...", "assistant");

    const { restoredText } = undoLastTurn(session);
    assert.equal(restoredText, "tell me more");
    assert.equal(session.toolResults.length, turnOneLength);
    assert.equal(session.toolResults[0]?.message, "hi");
    assert.equal(session.toolResults[1]?.message, "Hello! How can I help?");
    // runStartIndex now sits at the new end-of-results. The exact
    // value isn't load-bearing for downstream code (the next
    // beginUserTurn / applyTextEvent overwrites it), so we only
    // assert it stays inside the preserved range.
    assert.ok(
      session.runStartIndex <= session.toolResults.length,
      `runStartIndex ${session.runStartIndex} must not exceed length ${session.toolResults.length}`,
    );
  });

  it("clears resultTimestamps for every removed result", () => {
    // The timestamps map is keyed on uuid; if we splice a result
    // without clearing its timestamp entry the map slowly leaks.
    const session = createEmptySession("s1", "general");
    beginUserTurn(session, "first");
    applyTextEvent(session, "ok", "assistant");
    const removedUuids = session.toolResults.map((entry) => entry.uuid);
    assert.equal(session.resultTimestamps.size, removedUuids.length);

    undoLastTurn(session);
    assert.equal(session.resultTimestamps.size, 0);
    for (const uuid of removedUuids) {
      assert.equal(session.resultTimestamps.has(uuid), false);
    }
  });

  it("clears the selection when it pointed inside the removed range", () => {
    const session = createEmptySession("s1", "general");
    beginUserTurn(session, "ask");
    const partial = pushAssistantTextResult("partial");
    session.toolResults.push(partial);
    session.resultTimestamps.set(partial.uuid, Date.now());
    session.selectedResultUuid = partial.uuid;

    undoLastTurn(session);
    assert.equal(session.selectedResultUuid, null);
  });

  it("does NOT clear the selection when it points at a preserved earlier turn", () => {
    // applyTextEvent's auto-selection rules can move the selection
    // around mid-turn; undoLastTurn must not clobber a selection
    // that, at the moment of undo, points at an earlier-turn result.
    const session = createEmptySession("s1", "general");
    beginUserTurn(session, "first");
    const survivor = pushAssistantTextResult("survivor");
    session.toolResults.push(survivor);
    session.resultTimestamps.set(survivor.uuid, Date.now());

    beginUserTurn(session, "second");
    applyTextEvent(session, "partial", "assistant");
    // Pin the selection back onto the earlier-turn result right
    // before undo, isolating undoLastTurn's selection-preservation
    // behaviour from applyTextEvent's selection-promotion rule.
    session.selectedResultUuid = survivor.uuid;

    undoLastTurn(session);
    assert.equal(session.selectedResultUuid, survivor.uuid);
  });

  it("bails out (no-op) when the boundary doesn't point at a user message", () => {
    // Defensive guard: if some race / corrupt state leaves
    // runStartIndex pointing at an assistant result, don't shred
    // unrelated events. Just return null restoredText and leave the
    // session untouched.
    const session = createEmptySession("s1", "general");
    const stray = pushAssistantTextResult("not a user msg");
    session.toolResults.push(stray);
    session.resultTimestamps.set(stray.uuid, Date.now());
    session.runStartIndex = 1;

    const result = undoLastTurn(session);
    assert.equal(result.restoredText, null);
    assert.equal(session.toolResults.length, 1);
    assert.equal(session.runStartIndex, 1);
  });
});
