// Unit tests for the pure `extractOpenAIImageResult` helper — the
// OpenAI counterpart to Gemini's `extractImageResult`. The network
// call in `generateOpenAIImageFromPrompt` is not unit-tested (it is a
// thin `fetch` wrapper); the extraction is where a response-shape
// change would silently drop an image.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractOpenAIImageResult } from "../../src/image-generation/openai.ts";

describe("extractOpenAIImageResult", () => {
  it("returns an empty object when `data` is missing", () => {
    assert.deepEqual(extractOpenAIImageResult({}), {});
  });

  it("returns an empty object when `data` is empty", () => {
    assert.deepEqual(extractOpenAIImageResult({ data: [] }), {});
  });

  it("captures b64_json as `imageData`", () => {
    assert.deepEqual(extractOpenAIImageResult({ data: [{ b64_json: "BASE64==" }] }), { imageData: "BASE64==" });
  });

  it("captures revised_prompt as `message`", () => {
    assert.deepEqual(extractOpenAIImageResult({ data: [{ revised_prompt: "a cat, painterly" }] }), { message: "a cat, painterly" });
  });

  it("captures both fields from the first entry", () => {
    assert.deepEqual(extractOpenAIImageResult({ data: [{ b64_json: "AAAA", revised_prompt: "caption" }] }), {
      imageData: "AAAA",
      message: "caption",
    });
  });

  it("reads only the first entry", () => {
    assert.deepEqual(extractOpenAIImageResult({ data: [{ b64_json: "first" }, { b64_json: "second" }] }), { imageData: "first" });
  });

  it("skips an empty-string b64_json (falsy guard)", () => {
    assert.deepEqual(extractOpenAIImageResult({ data: [{ b64_json: "" }] }), {});
  });
});
