// Provider selection + the dispatcher every generate-image call site
// goes through. Selection is deployment-level: an explicit provider
// (from the host env) wins even when its key is missing — the call
// then fails per-request with a clear "…_API_KEY is not set", exactly
// as today's `getGeminiClient` does. When unset, the first available
// provider wins, defaulting to Gemini so today's error path is
// preserved.

import type { ImageGenConfig, ImageGenResult, ImageProvider } from "./types.js";
import { generateGeminiImageFromPrompt } from "./gemini.js";
import { generateOpenAIImageFromPrompt } from "./openai.js";

// Narrow a raw env string to a known provider, or `undefined` when it
// is unset / unrecognised (a typo falls through to availability).
function parseProvider(raw: string | undefined): ImageProvider | undefined {
  const value = raw?.trim().toLowerCase();
  if (value === "gemini" || value === "openai") return value;
  return undefined;
}

// Pure provider resolver. `geminiOk` / `openaiOk` report whether each
// key is configured. An explicit, recognised `config.provider` wins
// unconditionally; otherwise pick the first available, defaulting to
// Gemini.
export function resolveImageProvider(config: ImageGenConfig, geminiOk: boolean, openaiOk: boolean): ImageProvider {
  const explicit = parseProvider(config.provider);
  if (explicit) return explicit;
  if (geminiOk) return "gemini";
  if (openaiOk) return "openai";
  return "gemini";
}

// Dispatch a text-prompt image generation to the resolved provider.
// The single entry point for host generate-image routes.
export async function generateImageFromPrompt(config: ImageGenConfig, prompt: string, model?: string): Promise<ImageGenResult> {
  const geminiOk = Boolean(config.geminiApiKey);
  const openaiOk = Boolean(config.openaiApiKey);
  const provider = resolveImageProvider(config, geminiOk, openaiOk);
  if (provider === "openai") return generateOpenAIImageFromPrompt(config, prompt, model);
  return generateGeminiImageFromPrompt(config, prompt, model);
}
