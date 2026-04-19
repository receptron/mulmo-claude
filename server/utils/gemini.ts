import { GoogleGenAI, type GenerateContentParameters } from "@google/genai";
import { env } from "../system/env.js";

export { isGeminiAvailable } from "../system/env.js";

export function getGeminiClient(): GoogleGenAI {
  const apiKey = env.geminiApiKey;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
}

// --- Image generation -----------------------------------------------

const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";

const DEFAULT_IMAGE_CONFIG: GenerateContentParameters["config"] = {
  responseModalities: ["TEXT", "IMAGE"],
  imageConfig: { aspectRatio: "16:9" },
};

export interface GeminiImageResult {
  // Raw base64 payload (no `data:` prefix). Undefined if Gemini
  // declined to return an image, e.g. because the prompt was filtered.
  imageData?: string;
  // Optional text part returned alongside the image (or in lieu of
  // it). Used as a fallback message when imageData is empty.
  message?: string;
}

// Low-level wrapper around `ai.models.generateContent` that pulls
// the first inline image and text part out of the response. Use this
// when you need to pass custom `contents` (e.g. text + reference
// image for /edit-image). Pass `undefined` for `config` to omit it
// entirely from the request.
export async function generateGeminiImageContent(
  contents: GenerateContentParameters["contents"],
  config?: GenerateContentParameters["config"],
  model: string = DEFAULT_IMAGE_MODEL,
): Promise<GeminiImageResult> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model,
    contents,
    ...(config && { config }),
  });
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const result: GeminiImageResult = {};
  for (const part of parts) {
    if (part.text) result.message = part.text;
    if (part.inlineData?.data) result.imageData = part.inlineData.data;
  }
  return result;
}

// Convenience wrapper for the common "text prompt → image" path.
// Uses the standard 16:9 image config.
export async function generateGeminiImageFromPrompt(
  prompt: string,
  model?: string,
): Promise<GeminiImageResult> {
  return generateGeminiImageContent(
    [{ text: prompt }],
    DEFAULT_IMAGE_CONFIG,
    model,
  );
}
