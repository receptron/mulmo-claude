/**
 * Decode the `/api/files/content` response for a spreadsheet file
 * into an "ok with sheets" / "error with message" discriminated
 * union. Extracted from `fetchSheets` in
 * `src/plugins/spreadsheet/View.vue` where the decision tree was
 * inlined as several nested try/catch + if branches.
 *
 * Pure — no fetch, no refs. Takes the parsed JSON body and returns
 * a result the caller can pattern-match on. Tested in
 * `test/plugins/spreadsheet/engine/test_responseDecoder.ts`.
 */

import type { SheetData } from "./types.js";
import { errorMessage } from "../../../utils/errors";

/** Shape of the `/api/files/content` response we care about. The
 *  server returns more fields (kind, size, modifiedMs, …) but this
 *  decoder only depends on the three that drive branching. */
export interface FilesContentResponseLike {
  kind?: string;
  content?: string;
  message?: string;
}

export type DecodeResult = { kind: "ok"; sheets: SheetData[] } | { kind: "error"; message: string };

/**
 * Turn a parsed `/files/content` body into an OK/error decision:
 *
 * - `kind` present and not "text" → error with the server's message
 *   (e.g. "too-large", "binary"). Spreadsheets only live in text
 *   JSON files.
 * - Missing or non-string `content` → error.
 * - `content` is not valid JSON → error.
 * - Parsed `content` is not an array → error (server should never
 *   return a non-array but the guard protects downstream render).
 * - Otherwise → ok with the sheets array.
 */
export function decodeSpreadsheetResponse(body: FilesContentResponseLike): DecodeResult {
  if (body.kind && body.kind !== "text") {
    return {
      kind: "error",
      message: body.message ?? `Cannot load spreadsheet: ${body.kind}`,
    };
  }
  if (typeof body.content !== "string") {
    return { kind: "error", message: "Spreadsheet file has no content" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.content);
  } catch (err) {
    return {
      kind: "error",
      message: `Spreadsheet JSON is malformed: ${errorMessage(err, "parse error")}`,
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      kind: "error",
      message: "Spreadsheet content is not an array of sheets",
    };
  }
  // Array.isArray narrows to unknown[]; we trust the server contract
  // and type the local explicitly rather than using an inline `as`.
  const sheets: SheetData[] = parsed;
  return { kind: "ok", sheets };
}
