// Boot-time warning when GEMINI_API_KEY is absent (#2081). A missing key
// otherwise surfaces only as an opaque per-operation crash (movie beats)
// or a buried image-fill warning; announcing it once at startup makes the
// misconfiguration visible and points at the launch-dir `.env` where the
// key belongs. Kept as its own module (like announceOptionalDeps) so the
// generic boot sequence stays free of provider specifics. Never throws.

import { isGeminiAvailable, isOpenAIImageAvailable } from "./env.js";
import { log } from "./logger/index.js";

export const GEMINI_KEY_MISSING_MESSAGE =
  "GEMINI_API_KEY not set — image / audio / video generation is unavailable. Set it in a .env file in the directory you launch MulmoClaude from, or export it before starting.";

// When the OpenAI image provider covers image generation, the blanket
// message above is wrong about images. Audio / video (movie beats) stay
// Gemini-only, so warn about those alone.
export const GEMINI_KEY_MISSING_OPENAI_IMAGES_MESSAGE =
  "GEMINI_API_KEY not set — image generation uses OpenAI (OPENAI_API_KEY), but audio / video generation is unavailable. Set GEMINI_API_KEY in a .env file in the directory you launch MulmoClaude from, or export it before starting.";

export function announceGeminiKey(): void {
  if (isGeminiAvailable()) return;
  if (isOpenAIImageAvailable()) {
    log.warn("gemini", GEMINI_KEY_MISSING_OPENAI_IMAGES_MESSAGE);
    return;
  }
  log.warn("gemini", GEMINI_KEY_MISSING_MESSAGE);
}
