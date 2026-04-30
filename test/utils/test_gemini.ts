// Unit tests for the pure helpers in `server/utils/gemini.ts`.
//
// `generateGeminiImageContent` itself is a thin wrapper over the
// `@google/genai` SDK and isn't unit-tested here — exercising it
// would mean stubbing the SDK client, which buys little signal over
// just verifying the parts extraction (the only meaningful logic
// the wrapper does on its own). The three exported helpers below
// cover the response-shape narrowing exhaustively, which is where
// real bugs would surface (e.g. a Gemini response shape change
// silently dropping an image).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { GenerateContentResponse, Part } from "@google/genai";
import { extractImageResult, firstCandidateParts, firstFinishReason } from "../../server/utils/gemini.js";

// Construct a minimal GenerateContentResponse-shaped object for the
// helpers to read. Only the fields the helpers touch are populated;
// everything else stays undefined. Cast at the boundary so callers
// don't have to write the full SDK type.
function makeResponse(candidate: { content?: { parts?: Part[] } | null; finishReason?: string } | null = null): GenerateContentResponse {
  if (candidate === null) return {} as GenerateContentResponse;
  return { candidates: [candidate] } as GenerateContentResponse;
}

describe("extractImageResult", () => {
  it("returns an empty object for no parts", () => {
    assert.deepEqual(extractImageResult([]), {});
  });

  it("captures a plain text part as `message`", () => {
    const parts: Part[] = [{ text: "hello there" }];
    assert.deepEqual(extractImageResult(parts), { message: "hello there" });
  });

  it("captures a plain inline-image part as `imageData`", () => {
    const parts: Part[] = [{ inlineData: { data: "BASE64==" } }];
    assert.deepEqual(extractImageResult(parts), { imageData: "BASE64==" });
  });

  it("captures both fields when a single part has text + inlineData.data", () => {
    const parts: Part[] = [{ text: "caption", inlineData: { data: "AAAA" } }];
    assert.deepEqual(extractImageResult(parts), { message: "caption", imageData: "AAAA" });
  });

  it("captures across multiple parts (last non-empty wins)", () => {
    const parts: Part[] = [{ text: "first" }, { text: "second" }, { inlineData: { data: "X" } }, { inlineData: { data: "Y" } }];
    assert.deepEqual(extractImageResult(parts), { message: "second", imageData: "Y" });
  });

  it("skips parts whose text is empty / undefined / null", () => {
    const parts: Part[] = [{ text: "" }, { text: undefined }, { inlineData: { data: "IMG" } }];
    assert.deepEqual(extractImageResult(parts), { imageData: "IMG" });
  });

  it("skips parts whose inlineData has no `data`", () => {
    const parts: Part[] = [{ inlineData: { mimeType: "image/png" } }, { text: "fallback" }];
    assert.deepEqual(extractImageResult(parts), { message: "fallback" });
  });

  it("skips parts where inlineData.data is the empty string", () => {
    // Falsy guard on `inlineData?.data` — Gemini occasionally returns
    // an empty `data` when the safety filter trims the image.
    const parts: Part[] = [{ inlineData: { data: "" } }];
    assert.deepEqual(extractImageResult(parts), {});
  });

  it("ignores parts that have neither field", () => {
    // Function-call / executable-code parts surface in the array
    // alongside text/image parts. Helpers must tolerate them.
    const parts: Part[] = [{ functionCall: { name: "tool", args: {} } } as Part, { text: "tail" }];
    assert.deepEqual(extractImageResult(parts), { message: "tail" });
  });
});

describe("firstCandidateParts", () => {
  it("returns the first candidate's `content.parts`", () => {
    const parts: Part[] = [{ text: "hi" }];
    const out = firstCandidateParts(makeResponse({ content: { parts } }));
    assert.deepEqual(out, parts);
  });

  it("returns [] when `candidates` is missing", () => {
    assert.deepEqual(firstCandidateParts(makeResponse(null)), []);
  });

  it("returns [] when the first candidate has no `content`", () => {
    assert.deepEqual(firstCandidateParts(makeResponse({})), []);
  });

  it("returns [] when content has no `parts`", () => {
    assert.deepEqual(firstCandidateParts(makeResponse({ content: {} })), []);
  });

  it("returns [] when `content` is null (SDK can emit this on safety blocks)", () => {
    assert.deepEqual(firstCandidateParts(makeResponse({ content: null })), []);
  });
});

describe("firstFinishReason", () => {
  it("returns the first candidate's finish reason", () => {
    const response = makeResponse({ finishReason: "STOP" });
    assert.equal(firstFinishReason(response), "STOP");
  });

  it("returns undefined when finishReason is absent", () => {
    assert.equal(firstFinishReason(makeResponse({})), undefined);
  });

  it("returns undefined when there are no candidates", () => {
    assert.equal(firstFinishReason(makeResponse(null)), undefined);
  });
});
