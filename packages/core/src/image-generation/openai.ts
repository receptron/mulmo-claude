// OpenAI image-generation client. A single REST endpoint, so we call
// `fetch` directly rather than pull in the `openai` SDK. The prompt →
// image path mirrors the Gemini client: request a landscape image,
// return { imageData, message } for the host's provider-agnostic
// save-and-respond step.

import { errorMessage } from "../utils/errors.js";
import { type ImageGenConfig, type ImageGenResult, loggerFor } from "./types.js";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";

const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-1";

// Landscape ≈ the Gemini path's 16:9. `gpt-image-1` accepts a fixed
// set of sizes; 1536×1024 is its landscape option.
const OPENAI_IMAGE_SIZE = "1536x1024";

const ONE_MINUTE_MS = 60_000;

// Image generation is slow; give the request a generous ceiling so a
// healthy round-trip completes but a stuck upstream still errors out
// well before any client-side tool timeout.
const IMAGE_GENERATION_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

interface OpenAIImageData {
  b64_json?: string;
  revised_prompt?: string;
}

interface OpenAIImageResponse {
  data?: OpenAIImageData[];
}

interface OpenAIErrorResponse {
  error?: { message?: string };
}

// Reduce an OpenAI images response down to the {imageData, message}
// pair the rest of the app cares about: first entry's base64 payload
// and its revised prompt. Pure — exported for unit tests, mirroring
// the Gemini `extractImageResult`.
export function extractOpenAIImageResult(body: OpenAIImageResponse): ImageGenResult {
  const first = body.data?.[0];
  const result: ImageGenResult = {};
  if (first?.b64_json) result.imageData = first.b64_json;
  if (first?.revised_prompt) result.message = first.revised_prompt;
  return result;
}

// Best-effort extraction of the API's error message from a non-2xx
// body, falling back to a generic status label. Never throws.
function openAIErrorMessage(status: number, rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as OpenAIErrorResponse;
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Body wasn't JSON — fall through to the generic label.
  }
  return `OpenAI image request failed with status ${status}`;
}

// Text prompt → image via OpenAI. Throws on a missing key (mirroring
// `getGeminiClient`), a network failure, a timeout, or a non-2xx
// response — callers own the HTTP / canvas response.
export async function generateOpenAIImageFromPrompt(config: ImageGenConfig, prompt: string, model?: string): Promise<ImageGenResult> {
  const apiKey = config.openaiApiKey;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const log = loggerFor(config);
  const resolvedModel = model ?? config.openaiImageModel ?? DEFAULT_OPENAI_IMAGE_MODEL;

  log.debug("openai", "images: request", { model: resolvedModel, size: OPENAI_IMAGE_SIZE });

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`OpenAI image request timed out after ${IMAGE_GENERATION_TIMEOUT_MS}ms`, "TimeoutError"));
  }, IMAGE_GENERATION_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENAI_IMAGES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: resolvedModel, prompt, size: OPENAI_IMAGE_SIZE }),
      signal: controller.signal,
    });
  } catch (err) {
    log.debug("openai", "images: fetch threw", { model: resolvedModel, error: errorMessage(err) });
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    const message = openAIErrorMessage(response.status, rawBody);
    log.debug("openai", "images: non-ok response", { model: resolvedModel, status: response.status });
    throw new Error(message);
  }

  const body = (await response.json()) as OpenAIImageResponse;
  const result = extractOpenAIImageResult(body);
  log.debug("openai", "images: response", {
    model: resolvedModel,
    hasImage: Boolean(result.imageData),
    hasText: Boolean(result.message),
  });
  return result;
}
