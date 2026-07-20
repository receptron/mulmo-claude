// Server-only image-generation engine: a provider-neutral dispatcher
// (`generateImageFromPrompt`) over the Gemini + OpenAI clients, plus
// the moved Gemini image content helper for the edit-image path. Each
// host builds an `ImageGenConfig` from its own env + logger and passes
// it explicitly — the engine reads no `process.env`. See
// `plans/feat-image-provider-openai.md`.
export { generateImageFromPrompt, resolveImageProvider } from "./provider.js";
export {
  generateGeminiImageContent,
  generateGeminiImageFromPrompt,
  getGeminiClient,
  extractImageResult,
  firstCandidateParts,
  firstFinishReason,
} from "./gemini.js";
export { generateOpenAIImageFromPrompt, extractOpenAIImageResult } from "./openai.js";
export { type ImageGenConfig, type ImageGenLogger, type ImageGenResult, type ImageProvider } from "./types.js";
