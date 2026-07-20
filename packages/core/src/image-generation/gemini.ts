// Gemini image-generation client. Moved verbatim from the host
// `server/utils/gemini.ts` minus its env/log coupling: the API key and
// logger now arrive on an `ImageGenConfig` param so the module carries
// no dependency on host-only modules and MulmoTerminal can adopt it
// with a dep bump. The pure extractors are unchanged.

import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse, type Part } from "@google/genai";
import { errorMessage } from "../utils/errors.js";
import { type ImageGenConfig, type ImageGenResult, loggerFor } from "./types.js";

export function getGeminiClient(apiKey: string | undefined): GoogleGenAI {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
}

// --- Image generation -----------------------------------------------

const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";

const DEFAULT_IMAGE_CONFIG: GenerateContentParameters["config"] = {
  responseModalities: ["TEXT", "IMAGE"],
  imageConfig: { aspectRatio: "16:9" },
};

// Pull the first candidate's `content.parts` array out of a Gemini
// response, defaulting to `[]` when any layer of the optional chain is
// absent. Pure — exported for unit tests.
export function firstCandidateParts(response: GenerateContentResponse): readonly Part[] {
  return response.candidates?.[0]?.content?.parts ?? [];
}

// Pull the first candidate's `finishReason` (used in debug logs).
// Pure — exported for unit tests.
export function firstFinishReason(response: GenerateContentResponse): string | undefined {
  return response.candidates?.[0]?.finishReason;
}

// Reduce a Gemini response's `parts` array down to the {imageData,
// message} pair the rest of the app cares about. Last text wins; last
// inline-image wins. Parts without text or `inlineData.data` are
// skipped. Pure — exported for unit tests.
export function extractImageResult(parts: readonly Part[]): ImageGenResult {
  const result: ImageGenResult = {};
  for (const part of parts) {
    if (part.text) result.message = part.text;
    if (part.inlineData?.data) result.imageData = part.inlineData.data;
  }
  return result;
}

// Low-level wrapper around `ai.models.generateContent` that pulls
// the first inline image and text part out of the response. Use this
// when you need to pass custom `contents` (e.g. text + reference
// image for /edit-image). Pass `undefined` for `genConfig` to omit it
// entirely from the request.
//
// Per-call logging is deliberately at debug level so the route /
// plugin call sites can decide what surfaces to info/warn at their
// own granularity. SDK throws are caught here only to surface a
// debug line, then re-thrown — callers are still responsible for the
// HTTP / canvas response.
export async function generateGeminiImageContent(
  config: ImageGenConfig,
  contents: GenerateContentParameters["contents"],
  genConfig?: GenerateContentParameters["config"],
  model: string = DEFAULT_IMAGE_MODEL,
): Promise<ImageGenResult> {
  const log = loggerFor(config);
  const client = getGeminiClient(config.geminiApiKey);
  log.debug("gemini", "generateContent: request", {
    model,
    hasConfig: Boolean(genConfig),
    aspectRatio: genConfig?.imageConfig?.aspectRatio,
  });
  let response;
  try {
    response = await client.models.generateContent({
      model,
      contents,
      ...(genConfig && { config: genConfig }),
    });
  } catch (err) {
    log.debug("gemini", "generateContent: SDK threw", { model, error: errorMessage(err) });
    throw err;
  }
  const parts = firstCandidateParts(response);
  const result = extractImageResult(parts);
  log.debug("gemini", "generateContent: response", {
    model,
    parts: parts.length,
    hasImage: Boolean(result.imageData),
    hasText: Boolean(result.message),
    finishReason: firstFinishReason(response),
  });
  return result;
}

// Convenience wrapper for the common "text prompt → image" path.
// Uses the standard 16:9 image config.
export async function generateGeminiImageFromPrompt(config: ImageGenConfig, prompt: string, model?: string): Promise<ImageGenResult> {
  return generateGeminiImageContent(config, [{ text: prompt }], DEFAULT_IMAGE_CONFIG, model);
}
