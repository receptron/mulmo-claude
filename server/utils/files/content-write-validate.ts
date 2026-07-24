// Body-shape gates for the file-content write route. Pure: no fs, no Express —
// path resolution and the text-only check happen separately, after this.

import { errorMessage } from "../errors.js";
import { previewSnippet } from "../logPreview.js";

/** 1 MB — text content is embedded in a JSON response, so the cap is about
 *  what a payload can carry, not what the filesystem can hold. */
export const MAX_PREVIEW_BYTES = 1024 * 1024;

export type PutContentValidation =
  { ok: true; relPath: string; content: string; bytes: number } | { ok: false; logMsg: string; logExtra?: Record<string, unknown>; message: string };

/** Runtime-shape gate for the content-write body. Returns either the narrowed
 *  inputs plus their byte length (computed once and reused downstream), or a
 *  structured rejection carrying the log message, log extras, and the response
 *  message — so the caller can fan them out into `log.warn` + `badRequest`
 *  without rebuilding context.
 *
 *  `logExtra` is optional so the missing-path branch can omit it: passing `{}`
 *  to `log.warn` would emit `data: {}`, an observable change from the original
 *  no-third-arg call; `undefined` skips the field entirely. */
/** Read a request field, ignoring anything reached through the prototype
 *  chain. A real `express.json()` body is `JSON.parse` output and carries only
 *  own properties, so this rejects nothing legitimate — it closes the door on a
 *  polluted `Object.prototype` supplying a `path` the caller never sent. */
function ownField(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null && Object.hasOwn(body, key) ? (body as Record<string, unknown>)[key] : undefined;
}

export function validatePutContentRequest(body: unknown): PutContentValidation {
  const relPathRaw = ownField(body, "path");
  const contentRaw = ownField(body, "content");
  if (typeof relPathRaw !== "string" || relPathRaw.length === 0) {
    return { ok: false, logMsg: "PUT content: missing path", message: "path required" };
  }
  if (typeof contentRaw !== "string") {
    return {
      ok: false,
      logMsg: "PUT content: missing content",
      logExtra: { pathPreview: previewSnippet(relPathRaw) },
      message: "content required",
    };
  }
  const bytes = Buffer.byteLength(contentRaw, "utf-8");
  if (bytes > MAX_PREVIEW_BYTES) {
    return {
      ok: false,
      logMsg: "PUT content: too large",
      logExtra: { pathPreview: previewSnippet(relPathRaw), bytes },
      message: `content exceeds ${MAX_PREVIEW_BYTES} byte limit`,
    };
  }
  return { ok: true, relPath: relPathRaw, content: contentRaw, bytes };
}

/** Reject syntactically invalid JSON before it lands on disk, so a broken
 *  schema / config file can't be saved and then fail to load later. Only
 *  `.json` paths are checked — every other extension writes through. */
export function jsonSyntaxError(relPath: string, content: string): string | null {
  if (!relPath.toLowerCase().endsWith(".json")) return null;
  try {
    JSON.parse(content);
    return null;
  } catch (err) {
    return `Invalid JSON: ${errorMessage(err)}`;
  }
}
