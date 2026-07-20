// Per the timeout-policy comment in server/agent/mcp-server.ts, generative-AI work MUST be observable — silent
// partial failures hid the 10s bridge-timeout bug. Every image emits start/ok/failed/no-data + per-batch tally.
//
// The placeholder regex + substitution format are shared with MulmoTerminal via @mulmoclaude/markdown-plugin
// (fillImagePlaceholders); this file is MulmoClaude's host wiring — Gemini generation + workspace image store +
// observability. Image generation/storage is injected as `resolveImage`.
import path from "node:path";
import { fillImagePlaceholders, IMAGE_PLACEHOLDER, type ImagePlaceholderResult } from "@mulmoclaude/markdown-plugin";
import { generateGeminiImageFromPrompt } from "@mulmoclaude/core/image-generation";
import { imageGenConfig, isGeminiAvailable } from "../../system/env.js";
import { errorMessage } from "../errors.js";
import { promptMeta } from "../promptMeta.js";
import { log } from "../../system/logger/index.js";
import { saveImage } from "./image-store.js";

const LOG_PREFIX = "present-document";

// Re-export so existing importers keep their single source for the placeholder contract.
export { IMAGE_PLACEHOLDER };

async function generateImageFile(prompt: string, index: number, total: number): Promise<string | null> {
  const startedAt = Date.now();
  // Prompt is user-controlled and may contain credentials/PII; promptMeta logs {length, sha256} instead of raw bytes.
  const meta = promptMeta(prompt);
  log.info(LOG_PREFIX, "image gen start", { index, total, prompt: meta });
  try {
    const { imageData } = await generateGeminiImageFromPrompt(imageGenConfig(), prompt);
    const elapsedMs = Date.now() - startedAt;
    if (imageData) {
      const url = await saveImage(imageData);
      log.info(LOG_PREFIX, "image gen ok", { index, total, elapsedMs, url });
      // Workspace-rooted "/…" so the ref resolves the same regardless of document depth (#764 sharded documents
      // under artifacts/documents/YYYY/MM/; a relative path would be off by two directory levels). path.posix.join
      // normalises so a saveImage path that already starts with "/" can't produce a "//" ref.
      return path.posix.join("/", url);
    }
    log.warn(LOG_PREFIX, "image gen returned no image data", { index, total, elapsedMs, prompt: meta });
  } catch (err) {
    log.warn(LOG_PREFIX, "image gen failed", { index, total, elapsedMs: Date.now() - startedAt, error: errorMessage(err), prompt: meta });
  }
  return null;
}

function logBatchTally(results: ImagePlaceholderResult[], batchStartedAt: number): void {
  const total = results.length;
  const failed = results.filter((result) => !result.ref).length;
  const succeeded = total - failed;
  const elapsedMs = Date.now() - batchStartedAt;
  const level = failed > 0 ? "warn" : "info";
  log[level](LOG_PREFIX, "image batch done", { succeeded, failed, total, elapsedMs });
}

export async function fillMarkdownImagePlaceholders(markdown: string): Promise<string> {
  const placeholderCount = [...markdown.matchAll(IMAGE_PLACEHOLDER)].length;
  if (placeholderCount === 0) return markdown;

  const geminiOk = isGeminiAvailable();
  if (!geminiOk) {
    log.warn(LOG_PREFIX, "GEMINI_API_KEY not set — image placeholders will render as text markers", { placeholderCount });
  }

  const batchStartedAt = Date.now();
  if (geminiOk) log.info(LOG_PREFIX, "image batch start", { total: placeholderCount });

  // Gemini available → generate + store each; otherwise resolve every placeholder to null (text markers).
  const { markdown: filled, results } = await fillImagePlaceholders(markdown, {
    resolveImage: geminiOk ? generateImageFile : () => Promise.resolve(null),
  });

  if (geminiOk) logBatchTally(results, batchStartedAt);
  return filled;
}
