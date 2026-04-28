import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyMovieEvent,
  extractErrorMessage,
  getMissingCharacterKeys,
  parseSSEEventLine,
  shouldAutoRenderBeat,
  streamMovieEvents,
  validateBeatJSON,
  type MovieEventHandlers,
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
    assert.deepEqual(parseSSEEventLine('data: {"type":"beat_image_done","beatIndex":3}'), { type: "beat_image_done", beatIndex: 3 });
  });

  it("parses beat_audio_done with beatIndex", () => {
    assert.deepEqual(parseSSEEventLine('data: {"type":"beat_audio_done","beatIndex":0}'), { type: "beat_audio_done", beatIndex: 0 });
  });

  it("parses done with moviePath", () => {
    assert.deepEqual(parseSSEEventLine('data: {"type":"done","moviePath":"/tmp/out.mp4"}'), { type: "done", moviePath: "/tmp/out.mp4" });
  });

  it("parses error with message", () => {
    assert.deepEqual(parseSSEEventLine('data: {"type":"error","message":"boom"}'), { type: "error", message: "boom" });
  });

  it("returns unknown for recognised shape but missing/ill-typed fields", () => {
    // type is known but beatIndex missing
    assert.deepEqual(parseSSEEventLine('data: {"type":"beat_image_done"}'), {
      type: "unknown",
    });
    // beatIndex wrong type
    assert.deepEqual(parseSSEEventLine('data: {"type":"beat_image_done","beatIndex":"3"}'), { type: "unknown" });
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

// --- applyMovieEvent ---------------------------------------------

// Tiny spy factory — records which handler fired and with what
// argument. Keeps each test a single assertion rather than 3+
// checks per case.
interface HandlerSpy {
  handlers: MovieEventHandlers;
  calls: ({ name: "onBeatImageDone"; beatIndex: number } | { name: "onBeatAudioDone"; beatIndex: number } | { name: "onDone"; moviePath: string })[];
}

function makeSpy(): HandlerSpy {
  const spy: HandlerSpy = {
    calls: [],
    handlers: {
      onBeatImageDone(beatIndex) {
        spy.calls.push({ name: "onBeatImageDone", beatIndex });
      },
      onBeatAudioDone(beatIndex) {
        spy.calls.push({ name: "onBeatAudioDone", beatIndex });
      },
      onDone(moviePath) {
        spy.calls.push({ name: "onDone", moviePath });
      },
    },
  };
  return spy;
}

describe("applyMovieEvent", () => {
  it("routes beat_image_done to onBeatImageDone with the beat index", () => {
    const spy = makeSpy();
    applyMovieEvent({ type: "beat_image_done", beatIndex: 3 }, spy.handlers);
    assert.deepEqual(spy.calls, [{ name: "onBeatImageDone", beatIndex: 3 }]);
  });

  it("routes beat_audio_done to onBeatAudioDone", () => {
    const spy = makeSpy();
    applyMovieEvent({ type: "beat_audio_done", beatIndex: 7 }, spy.handlers);
    assert.deepEqual(spy.calls, [{ name: "onBeatAudioDone", beatIndex: 7 }]);
  });

  it("routes done to onDone with the movie path", () => {
    const spy = makeSpy();
    applyMovieEvent({ type: "done", moviePath: "movies/final.mp4" }, spy.handlers);
    assert.deepEqual(spy.calls, [{ name: "onDone", moviePath: "movies/final.mp4" }]);
  });

  it("throws on error events with the server-provided message", () => {
    const spy = makeSpy();
    assert.throws(() => applyMovieEvent({ type: "error", message: "ffmpeg boom" }, spy.handlers), /ffmpeg boom/);
    // No handler called for the error path.
    assert.equal(spy.calls.length, 0);
  });

  it("silently ignores unknown events (forward-compat for new server types)", () => {
    const spy = makeSpy();
    applyMovieEvent({ type: "unknown" }, spy.handlers);
    assert.equal(spy.calls.length, 0);
  });

  it("handles beatIndex 0 correctly (falsy boundary)", () => {
    // Guard against a `if (beatIndex)` regression — index 0 is a
    // legitimate first beat and must reach the handler.
    const spy = makeSpy();
    applyMovieEvent({ type: "beat_image_done", beatIndex: 0 }, spy.handlers);
    assert.deepEqual(spy.calls, [{ name: "onBeatImageDone", beatIndex: 0 }]);
  });

  it("does not stop on repeated events — the caller decides idempotency", () => {
    const spy = makeSpy();
    applyMovieEvent({ type: "done", moviePath: "a" }, spy.handlers);
    applyMovieEvent({ type: "done", moviePath: "b" }, spy.handlers);
    assert.deepEqual(spy.calls, [
      { name: "onDone", moviePath: "a" },
      { name: "onDone", moviePath: "b" },
    ]);
  });
});

// --- streamMovieEvents ------------------------------------------

// Build a ReadableStream<Uint8Array> from an array of string chunks
// — the caller's byte stream boundary is what exercises the
// internal buffer-remainder handling.
function streamFromChunks(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i++;
    },
  });
}

describe("streamMovieEvents", () => {
  it("parses every newline-terminated event in a single-chunk body", async () => {
    const chunks = [
      `data: ${JSON.stringify({ type: "beat_image_done", beatIndex: 1 })}\n` +
        `data: ${JSON.stringify({ type: "beat_audio_done", beatIndex: 2 })}\n` +
        `data: ${JSON.stringify({ type: "done", moviePath: "x.mp4" })}\n`,
    ];
    const spy = makeSpy();
    await streamMovieEvents(streamFromChunks(chunks), spy.handlers);
    assert.deepEqual(spy.calls, [
      { name: "onBeatImageDone", beatIndex: 1 },
      { name: "onBeatAudioDone", beatIndex: 2 },
      { name: "onDone", moviePath: "x.mp4" },
    ]);
  });

  it("reassembles an event split across two chunks", async () => {
    // The JSON body is sliced mid-way so the first chunk ends in
    // the middle of a `data:` line. `streamMovieEvents` must
    // buffer the partial line and complete it on the next read.
    const payload = `data: ${JSON.stringify({
      type: "done",
      moviePath: "boundary.mp4",
    })}\n`;
    const mid = Math.floor(payload.length / 2);
    const spy = makeSpy();
    await streamMovieEvents(streamFromChunks([payload.slice(0, mid), payload.slice(mid)]), spy.handlers);
    assert.deepEqual(spy.calls, [{ name: "onDone", moviePath: "boundary.mp4" }]);
  });

  it("skips comment / blank / malformed lines", async () => {
    const chunks = [`:keepalive\n\nnot a data line\ndata: { not json\ndata: ${JSON.stringify({ type: "done", moviePath: "ok.mp4" })}\n`];
    const spy = makeSpy();
    await streamMovieEvents(streamFromChunks(chunks), spy.handlers);
    assert.deepEqual(spy.calls, [{ name: "onDone", moviePath: "ok.mp4" }]);
  });

  it("propagates error events by throwing (caller's try/catch)", async () => {
    const chunks = [
      `data: ${JSON.stringify({ type: "beat_image_done", beatIndex: 0 })}\n` +
        `data: ${JSON.stringify({ type: "error", message: "server exploded" })}\n` +
        // This last line should never be reached.
        `data: ${JSON.stringify({ type: "done", moviePath: "unreachable" })}\n`,
    ];
    const spy = makeSpy();
    await assert.rejects(() => streamMovieEvents(streamFromChunks(chunks), spy.handlers), /server exploded/);
    // Only the first (pre-error) event was dispatched.
    assert.deepEqual(spy.calls, [{ name: "onBeatImageDone", beatIndex: 0 }]);
  });

  it("returns cleanly when the stream closes with no events", async () => {
    const spy = makeSpy();
    await streamMovieEvents(streamFromChunks([]), spy.handlers);
    assert.equal(spy.calls.length, 0);
  });
});
