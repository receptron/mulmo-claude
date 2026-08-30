// The pubsub boundary must not drop `root` (#3014).
//
// Four separate rounds of #3015 had the same shape: a comparison or a key was
// widened to the pair `(root, filePath)`, while the path that CARRIES the root
// to it was not. The parsers here are the last such path — they rebuild each
// event field by field, so any field nobody listed is silently discarded, and
// a downstream pair check then compares `undefined` against every named root
// and filters out exactly the events it was written to route.
//
// A round trip is the only assertion that catches that class: it fails when a
// field is added to the contract and not to the parser.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGenerationEvent, parseScriptChangedEvent } from "../src/vue/transport";
import type { MulmoScriptChangedEvent, MulmoScriptGenerationEvent } from "../src/core/contract";

describe("the pubsub boundary preserves the root", () => {
  it("keeps `root` on a generation event", () => {
    const wire: MulmoScriptGenerationEvent = { kind: "movie", filePath: "stories/deck.json", key: "", done: false, root: "repoA" };
    assert.deepEqual(parseGenerationEvent(wire), wire);
  });

  it("keeps `root` on a script-changed event", () => {
    const wire: MulmoScriptChangedEvent = { filePath: "stories/deck.json", origin: "view-1", root: "repoA" };
    assert.deepEqual(parseScriptChangedEvent(wire), wire);
  });

  it("omits `root` when the server omitted it, so the default root round-trips unchanged", () => {
    // A pre-#3014 event must survive byte for byte: the downstream comparison
    // normalizes absent to the default, and an invented `root: ""` would be a
    // different shape on the wire for no reason.
    const generation = { kind: "movie", filePath: "stories/deck.json", key: "", done: true };
    assert.deepEqual(parseGenerationEvent(generation), generation);
    const changed = { filePath: "stories/deck.json" };
    assert.deepEqual(parseScriptChangedEvent(changed), changed);
  });

  it("rejects a payload whose root is present but not a string", () => {
    // This test used to assert the OPPOSITE — that a malformed root was
    // dropped and the rest of the event kept. That is wrong, and it is wrong
    // in the direction this whole PR keeps failing in: `undefined` is a
    // meaningful value here (the default root), so flattening `42` into it
    // does not discard information, it CHANGES WHICH FILE the event is about.
    // A default-root View would then act on a named root's event
    // (CodeRabbit on #3015).
    for (const root of [42, null, {}, ["repoA"], true]) {
      assert.equal(parseGenerationEvent({ kind: "movie", filePath: "stories/deck.json", key: "", done: false, root }), null, `root: ${JSON.stringify(root)}`);
      assert.equal(parseScriptChangedEvent({ filePath: "stories/deck.json", root }), null, `root: ${JSON.stringify(root)}`);
    }
  });

  it("rejects a payload whose origin is present but not a string", () => {
    // `origin` is identity too: read as absent, a View acts on the echo of its
    // own write and rebuilds the element the caret is in on every keystroke.
    for (const origin of [42, null, {}, true]) {
      assert.equal(parseScriptChangedEvent({ filePath: "stories/deck.json", origin }), null, `origin: ${JSON.stringify(origin)}`);
    }
  });

  it("keeps a finish event whose error field is malformed", () => {
    // The one field that is dropped rather than rejected. It is a message
    // shown beside a finished generation; rejecting the event would drop the
    // FINISH and leave the spinner running forever, which is worse than
    // losing the text.
    const parsed = parseGenerationEvent({ kind: "movie", filePath: "stories/deck.json", key: "", done: true, error: 42 });
    assert.ok(parsed, "a finish must still arrive");
    assert.equal(parsed.done, true);
    assert.ok(!("error" in parsed));
  });
});
