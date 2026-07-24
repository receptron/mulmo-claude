import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  beatMayHaveMovie,
  clearReactiveRecords,
  getMissingCharacterKeys,
  isAllSlideDeck,
  isSameScript,
  resolveSilentAdvanceSeconds,
  shouldAutoRenderBeat,
  validateBeatJSON,
  type SafeParseSchema,
} from "../src/vue/helpers";
import { errorMessage } from "@mulmoclaude/common";

// Ported from the host's test/plugins/presentMulmoScript/test_helpers.ts
// when the View moved into this package (phase 2). The SSE-stream helper
// suites did not move — per-beat generation progress now arrives on the
// plugin pubsub channel, so those helpers were deleted with the port.

describe("shouldAutoRenderBeat", () => {
  const autoTypes = ["textSlide", "markdown", "chart"] as const;

  it("returns false when the script has characters, regardless of type", () => {
    assert.equal(shouldAutoRenderBeat({ image: { type: "textSlide" } }, true, autoTypes), false);
  });

  it("returns true for an auto-render type when no characters", () => {
    assert.equal(shouldAutoRenderBeat({ image: { type: "markdown" } }, false, autoTypes), true);
  });

  it("returns false for a type outside the whitelist", () => {
    assert.equal(shouldAutoRenderBeat({ image: { type: "imagePrompt" } }, false, autoTypes), false);
  });

  it("returns false when beat has no image", () => {
    assert.equal(shouldAutoRenderBeat({}, false, autoTypes), false);
  });

  it("returns false when image is present but has no type", () => {
    assert.equal(shouldAutoRenderBeat({ image: {} }, false, autoTypes), false);
  });
});

describe("getMissingCharacterKeys", () => {
  it("returns keys with no image and no 'rendering' state", () => {
    const result = getMissingCharacterKeys(["alice", "bob", "carol"], { alice: "data:..." }, { bob: "rendering" });
    assert.deepEqual(result, ["carol"]);
  });

  it("returns empty array when all keys have images", () => {
    const result = getMissingCharacterKeys(["a", "b"], { a: "x", b: "y" }, {});
    assert.deepEqual(result, []);
  });

  it("returns all keys when nothing is loaded or rendering", () => {
    const result = getMissingCharacterKeys(["a", "b"], {}, {});
    assert.deepEqual(result, ["a", "b"]);
  });

  it("returns empty array when keys is empty", () => {
    assert.deepEqual(getMissingCharacterKeys([], {}, {}), []);
  });

  it("treats 'error' state as missing (not rendering, no image)", () => {
    // After a failed render, the image is absent and state is 'error'
    // — the helper should include that key so a retry can happen.
    const result = getMissingCharacterKeys(["alice"], {}, { alice: "error" });
    assert.deepEqual(result, ["alice"]);
  });
});

describe("validateBeatJSON", () => {
  const passSchema: SafeParseSchema = { safeParse: () => ({ success: true }) };
  const failSchema: SafeParseSchema = { safeParse: () => ({ success: false }) };

  it("returns true for parseable JSON that passes the schema", () => {
    assert.equal(validateBeatJSON('{"speaker":"X"}', passSchema), true);
  });

  it("returns false for parseable JSON that fails the schema", () => {
    assert.equal(validateBeatJSON('{"bad":true}', failSchema), false);
  });

  it("returns false for malformed JSON", () => {
    assert.equal(validateBeatJSON("{not json", passSchema), false);
  });

  it("returns false for an empty string", () => {
    assert.equal(validateBeatJSON("", passSchema), false);
  });

  it("passes the parsed object (not the raw string) to the schema", () => {
    let received: unknown;
    const spy: SafeParseSchema = {
      safeParse(value) {
        received = value;
        return { success: true };
      },
    };
    validateBeatJSON('{"x":1}', spy);
    assert.deepEqual(received, { x: 1 });
  });
});

describe("errorMessage", () => {
  it("returns the message from an Error instance", () => {
    assert.equal(errorMessage(new Error("boom")), "boom");
  });

  it("returns a subclass Error message", () => {
    class CustomError extends Error {}
    assert.equal(errorMessage(new CustomError("nope")), "nope");
  });

  it("coerces a string", () => {
    assert.equal(errorMessage("plain string"), "plain string");
  });

  it("coerces a number", () => {
    assert.equal(errorMessage(404), "404");
  });

  it("coerces null and undefined", () => {
    assert.equal(errorMessage(null), "null");
    assert.equal(errorMessage(undefined), "undefined");
  });

  it("coerces an object without message/details fields", () => {
    assert.equal(errorMessage({ foo: "bar" }), "[object Object]");
  });

  it("surfaces object message / gRPC details fields", () => {
    assert.equal(errorMessage({ message: "from message" }), "from message");
    assert.equal(errorMessage({ details: "from details", code: 3 }), "from details");
  });
});

describe("isSameScript (#1074)", () => {
  it("returns true when two scripts serialise identically", () => {
    const left = { title: "x", beats: [{ text: "" }] };
    const right = { title: "x", beats: [{ text: "" }] };
    assert.equal(isSameScript(left, right), true);
  });

  it("returns false when a single field differs", () => {
    const left = { title: "x", beats: [{ text: "" }] };
    const right = { title: "x", beats: [{ text: "edited" }] };
    assert.equal(isSameScript(left, right), false);
  });

  it("treats different key insertion order as different — false negatives are cheap, false positives are not", () => {
    // We intentionally rely on JSON.stringify's insertion-order
    // semantics here. If two scripts have the same fields but
    // different key order this returns false, which costs us one
    // wasted `emit("updateResult", ...)` — strictly safer than
    // dropping a real edit on the floor.
    const left = { title: "x", lang: "en" };
    const right = { lang: "en", title: "x" };
    assert.equal(isSameScript(left, right), false);
  });

  it("returns true for two empty objects", () => {
    assert.equal(isSameScript({}, {}), true);
  });
});

describe("isAllSlideDeck", () => {
  it("returns true when every beat is a slide", () => {
    const script = {
      beats: [{ image: { type: "slide", slide: { layout: "title", title: "A" } } }, { image: { type: "slide", slide: { layout: "bigQuote", quote: "hi" } } }],
    };
    assert.equal(isAllSlideDeck(script), true);
  });

  it("returns false when any beat is non-slide", () => {
    const mixed = {
      beats: [{ image: { type: "slide", slide: { layout: "title", title: "A" } } }, { image: { type: "movie", source: { kind: "path", path: "x.mp4" } } }],
    };
    assert.equal(isAllSlideDeck(mixed), false);

    const oneTextSlide = {
      beats: [{ image: { type: "textSlide", slide: { title: "hello" } } }],
    };
    assert.equal(isAllSlideDeck(oneTextSlide), false);
  });

  it("returns false for empty / missing beats", () => {
    assert.equal(isAllSlideDeck({ beats: [] }), false);
    assert.equal(isAllSlideDeck({}), false);
    assert.equal(isAllSlideDeck({ beats: undefined }), false);
  });

  it("returns false when a beat has no image", () => {
    assert.equal(isAllSlideDeck({ beats: [{}] }), false);
    assert.equal(isAllSlideDeck({ beats: [{ image: null }] }), false);
  });

  it("returns false for non-object inputs", () => {
    assert.equal(isAllSlideDeck(null), false);
    assert.equal(isAllSlideDeck(undefined), false);
    assert.equal(isAllSlideDeck("string"), false);
    assert.equal(isAllSlideDeck(42), false);
    assert.equal(isAllSlideDeck([]), false);
  });

  it("returns false when beat is not an object", () => {
    assert.equal(isAllSlideDeck({ beats: [null] }), false);
    assert.equal(isAllSlideDeck({ beats: ["not a beat"] }), false);
  });
});

describe("beatMayHaveMovie", () => {
  it("returns true for moviePrompt beats", () => {
    assert.equal(beatMayHaveMovie({ moviePrompt: "a hand draws the sketch" }), true);
  });

  it("returns true for animated html_tailwind beats (boolean and options-object forms)", () => {
    assert.equal(beatMayHaveMovie({ image: { type: "html_tailwind", animation: true } }), true);
    assert.equal(beatMayHaveMovie({ image: { type: "html_tailwind", animation: { fps: 30 } } }), true);
  });

  it("returns false for html_tailwind without animation", () => {
    assert.equal(beatMayHaveMovie({ image: { type: "html_tailwind" } }), false);
  });

  it("returns false for animation on a non-html_tailwind type", () => {
    assert.equal(beatMayHaveMovie({ image: { type: "markdown", animation: true } }), false);
  });

  it("returns false for image-only, text-only, and empty beats", () => {
    assert.equal(beatMayHaveMovie({ image: { type: "textSlide" } }), false);
    assert.equal(beatMayHaveMovie({ moviePrompt: "" }), false);
    assert.equal(beatMayHaveMovie({}), false);
  });
});

describe("resolveSilentAdvanceSeconds", () => {
  const DEFAULT_SEC = 3;

  it("returns a valid positive number unchanged", () => {
    assert.equal(resolveSilentAdvanceSeconds(5, DEFAULT_SEC), 5);
    assert.equal(resolveSilentAdvanceSeconds(0.5, DEFAULT_SEC), 0.5);
  });

  it("falls back to the default for zero and negatives — they would fire the timer immediately and race the Play loop", () => {
    assert.equal(resolveSilentAdvanceSeconds(0, DEFAULT_SEC), DEFAULT_SEC);
    assert.equal(resolveSilentAdvanceSeconds(-1, DEFAULT_SEC), DEFAULT_SEC);
  });

  it("falls back to the default for NaN and Infinity", () => {
    assert.equal(resolveSilentAdvanceSeconds(NaN, DEFAULT_SEC), DEFAULT_SEC);
    assert.equal(resolveSilentAdvanceSeconds(Infinity, DEFAULT_SEC), DEFAULT_SEC);
  });

  it("falls back to the default for non-number and missing durations", () => {
    assert.equal(resolveSilentAdvanceSeconds("3", DEFAULT_SEC), DEFAULT_SEC);
    assert.equal(resolveSilentAdvanceSeconds(undefined, DEFAULT_SEC), DEFAULT_SEC);
    assert.equal(resolveSilentAdvanceSeconds(null, DEFAULT_SEC), DEFAULT_SEC);
  });
});

describe("clearReactiveRecords", () => {
  it("deletes every own key of a single record in place", () => {
    const record: Record<string, number> = { a: 1, b: 2, c: 3 };
    clearReactiveRecords(record);
    assert.deepEqual(record, {});
  });

  it("clears every record passed", () => {
    const first: Record<string, number> = { a: 1 };
    const second: Record<number, string> = { 0: "x", 1: "y" };
    clearReactiveRecords(first, second);
    assert.deepEqual(first, {});
    assert.deepEqual(second, {});
  });

  it("mutates in place — same object reference, now empty", () => {
    const record: Record<string, boolean> = { on: true };
    const before = record;
    clearReactiveRecords(record);
    assert.equal(record, before);
    assert.deepEqual(Object.keys(record), []);
  });

  it("is a no-op on an already-empty record and on zero arguments", () => {
    const record: Record<string, number> = {};
    clearReactiveRecords(record);
    assert.deepEqual(record, {});
    assert.doesNotThrow(() => clearReactiveRecords());
  });
});
