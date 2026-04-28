// Per the timeout-policy comment in server/agent/mcp-server.ts, generative-AI work MUST be observable — silent
// partial failures hid the 10s bridge-timeout bug. Every image emits start/ok/failed/no-data + per-batch tally.
import { generateGeminiImageFromPrompt, isGeminiAvailable } from "../gemini.js";
import { errorMessage } from "../errors.js";
import { promptMeta } from "../promptMeta.js";
import { log } from "../../system/logger/index.js";
import { saveImage } from "./image-store.js";

export const IMAGE_PLACEHOLDER = /!\[([^\]]+)\]\(\/?__too_be_replaced_image_path__\)/g;
const LOG_PREFIX = "present-document";

async function generateImageFile(prompt: string, index: number, total: number): Promise<string | null> {
  if (!isGeminiAvailable()) return null;
  const startedAt = Date.now();
  // Prompt is user-controlled and may contain credentials/PII; promptMeta logs {length, sha256} instead of raw bytes.
  const meta = promptMeta(prompt);
  log.info(LOG_PREFIX, "image gen start", {
    index,
    total,
    prompt: meta,
  });
  try {
    const { imageData } = await generateGeminiImageFromPrompt(prompt);
    const elapsedMs = Date.now() - startedAt;
    if (imageData) {
      const url = await saveImage(imageData);
      log.info(LOG_PREFIX, "image gen ok", { index, total, elapsedMs, url });
      return url;
    }
    log.warn(LOG_PREFIX, "image gen returned no image data", {
      index,
      total,
      elapsedMs,
      prompt: meta,
    });
  } catch (err) {
    log.warn(LOG_PREFIX, "image gen failed", {
      index,
      total,
      elapsedMs: Date.now() - startedAt,
      error: errorMessage(err),
      prompt: meta,
    });
  }
  return null;
}

interface PlaceholderResult {
  full: string;
  prompt: string;
  url: string | null;
}

function logBatchTally(results: PlaceholderResult[], total: number, batchStartedAt: number): void {
  const failed = results.filter((result) => !result.url).length;
  const succeeded = total - failed;
  const elapsedMs = Date.now() - batchStartedAt;
  const level = failed > 0 ? "warn" : "info";
  log[level](LOG_PREFIX, "image batch done", { succeeded, failed, total, elapsedMs });
}

export function buildReplacement(prompt: string, url: string | null): string {
  // Workspace-rooted "/…" so the ref resolves the same regardless of document depth (#764 sharded documents under
  // artifacts/documents/YYYY/MM/; a relative path would be off by two directory levels).
  if (url) return `![${prompt}](/${url})`;
  // No image: leave the alt text as an italic marker so the operator can see what *would* have been generated.
  return `*🖼️ Image: ${prompt}*`;
}

export async function fillMarkdownImagePlaceholders(markdown: string): Promise<string> {
  const matches = [...markdown.matchAll(IMAGE_PLACEHOLDER)];
  if (matches.length === 0) return markdown;

  const geminiOk = isGeminiAvailable();
  if (!geminiOk) {
    log.warn(LOG_PREFIX, "GEMINI_API_KEY not set — image placeholders will render as text markers", {
      placeholderCount: matches.length,
    });
  }

  const total = matches.length;
  const batchStartedAt = Date.now();
  if (geminiOk) log.info(LOG_PREFIX, "image batch start", { total });

  const results: PlaceholderResult[] = await Promise.all(
    matches.map(async (match, index) => ({
      full: match[0],
      prompt: match[1],
      url: geminiOk ? await generateImageFile(match[1], index, total) : null,
    })),
  );

  if (geminiOk) logBatchTally(results, total, batchStartedAt);

  let filled = markdown;
  for (const { full, prompt, url } of results) {
    filled = filled.replace(full, buildReplacement(prompt, url));
  }
  return filled;
}
