// Replace `![alt](__too_be_replaced_image_path__)` placeholders in
// markdown with real Gemini-generated images saved to the workspace.
// Lives under `server/utils/files/` because it sits at the seam
// between markdown content and on-disk image artifacts; route
// handlers (e.g. `presentDocument`) just hand off the markdown.
//
// Logging policy: every image generation emits start / ok / failed /
// no-data lines, and every batch emits a tally. Per the timeout-policy
// comment in `server/agent/mcp-server.ts`, generative-AI work MUST be
// observable — silent partial failures were the exact failure mode
// that hid the 10 s bridge-timeout bug.
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
  // Prompt is user-controlled and may contain pasted URLs / emails /
  // credentials, so we log a `{ length, sha256 }` fingerprint instead
  // of a raw prefix. See `server/utils/promptMeta.ts`.
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
  // `url` is workspace-relative (e.g. "artifacts/images/2026/04/x.png").
  // Emit a workspace-root absolute ref ("/...") so the resolution is
  // independent of where the markdown file itself lands on disk.
  // Since #764, documents shard under `artifacts/documents/YYYY/MM/`,
  // and `rewriteMarkdownImageRefs` (front-end) treats a leading "/"
  // as "rooted at workspace" — so a markdown reference like
  // "![alt](/artifacts/images/...)" works regardless of the document's
  // depth. A relative path computed against the unsharded root would
  // instead be off by two directory levels and 404 in the canvas.
  if (url) return `![${prompt}](/${url})`;
  // No image: keep the alt text visible as an italic marker so the
  // operator can still see what *would* have been generated.
  return `*🖼️ Image: ${prompt}*`;
}

/**
 * Replace every `![alt](__too_be_replaced_image_path__)` placeholder
 * in the input markdown with a real Gemini-generated image.
 *
 * - When `GEMINI_API_KEY` is unset, every placeholder degrades to an
 *   italic text marker (`*🖼️ Image: <alt>*`) so the document still
 *   renders without broken image refs.
 * - On per-image failure, the same fallback applies for that one
 *   placeholder. Other placeholders proceed independently.
 * - All generation runs in parallel via `Promise.all` — typical 9-image
 *   batches finish in 15-25 s rather than per-image-serial.
 */
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
