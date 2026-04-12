import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractErrorMessage,
  getMissingCharacterKeys,
  parseSSEEventLine,
  shouldAutoRenderBeat,
  validateBeatJSON,
  type SafeParseSchema,
} from "../../../src/plugins/presentMulmoScript/helpers.js";

describe("parseSSEEventLine", () => {
  it("returns null for non-data lines", () => {
    assert.equal(parseSSEEventLine(""), null);
    assert.equal(parseSSEEventLine(":ping"), null);
    assert.equal(parseSSEEventLine("event: foo"), null);
  });

  it("returns null for invalid JSON in the data payload", () => {
    assert.equal(parseSSEEventLine("data: {not json"), null);
    assert.equal(parseSSEEventLine("data: "), null);
  });

  it("returns null when the JSON is not an object", () => {
    assert.equal(parseSSEEventLine("data: 42"), null);
    assert.equal(parseSSEEventLine('data: "hello"'), null);
    assert.equal(parseSSEEventLine("data: null"), null);
  });

  it("parses beat_image_done with beatIndex", () => {
    assert.deepEqual(
      parseSSEEventLine('data: {"type":"beat_image_done","beatIndex":3}'),
      { type: "beat_image_done", beatIndex: 3 },
    );
  });

  it("parses beat_audio_done with beatIndex", () => {
    assert.deepEqual(
      parseSSEEventLine('data: {"type":"beat_audio_done","beatIndex":0}'),
      { type: "beat_audio_done", beatIndex: 0 },
    );
  });

  it("parses done with moviePath", () => {
    assert.deepEqual(
      parseSSEEventLine('data: {"type":"done","moviePath":"/tmp/out.mp4"}'),
      { type: "done", moviePath: "/tmp/out.mp4" },
    );
  });

  it("parses error with message", () => {
    assert.deepEqual(
      parseSSEEventLine('data: {"type":"error","message":"boom"}'),
      { type: "error", message: "boom" },
    );
  });

  it("returns unknown for recognised shape but missing/ill-typed fields", () => {
    // type is known but beatIndex missing
    assert.deepEqual(parseSSEEventLine('data: {"type":"beat_image_done"}'), {
      type: "unknown",
    });
    // beatIndex wrong type
    assert.deepEqual(
      parseSSEEventLine('data: {"type":"beat_image_done","beatIndex":"3"}'),
      { type: "unknown" },
    );
    // unknown type
    assert.deepEqual(parseSSEEventLine('data: {"type":"progress"}'), {
      type: "unknown",
    });
    // no type
    assert.deepEqual(parseSSEEventLine("data: {}"), { type: "unknown" });
  });
});

describe("shouldAutoRenderBeat", () => {
  const autoTypes = ["textSlide", "markdown", "chart"] as const;

  it("returns false when the script has characters, regardless of type", () => {
    assert.equal(
      shouldAutoRenderBeat({ image: { type: "textSlide" } }, true, autoTypes),
      false,
    );
  });

  it("returns true for an auto-render type when no characters", () => {
    assert.equal(
      shouldAutoRenderBeat({ image: { type: "markdown" } }, false, autoTypes),
      true,
    );
  });

  it("returns false for a type outside the whitelist", () => {
    assert.equal(
      shouldAutoRenderBeat(
        { image: { type: "imagePrompt" } },
        false,
        autoTypes,
      ),
      false,
    );
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
    const result = getMissingCharacterKeys(
      ["alice", "bob", "carol"],
      { alice: "data:..." },
      { bob: "rendering" },
    );
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
    let received: unknown = undefined;
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

describe("extractErrorMessage", () => {
  it("returns the message from an Error instance", () => {
    assert.equal(extractErrorMessage(new Error("boom")), "boom");
  });

  it("returns a subclass Error message", () => {
    class CustomError extends Error {}
    assert.equal(extractErrorMessage(new CustomError("nope")), "nope");
  });

  it("coerces a string", () => {
    assert.equal(extractErrorMessage("plain string"), "plain string");
  });

  it("coerces a number", () => {
    assert.equal(extractErrorMessage(404), "404");
  });

  it("coerces null and undefined", () => {
    assert.equal(extractErrorMessage(null), "null");
    assert.equal(extractErrorMessage(undefined), "undefined");
  });

  it("coerces an object", () => {
    assert.equal(extractErrorMessage({ foo: "bar" }), "[object Object]");
  });
});
