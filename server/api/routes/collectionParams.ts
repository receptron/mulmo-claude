// Request-shape parsing for the collection routes. Pure: no I/O, no Express
// beyond the value types, so each can be exercised directly.
//
// `parseListParam` and `csvParam` look like duplicates and are NOT: one trims
// and drops empty entries, the other preserves them verbatim. They serve
// different callers on a frozen public contract (see the view-data note in
// `collections.ts`), so merging them would change what a persisted custom view
// receives. Kept apart deliberately.

import type { CollectionItem } from "../../workspace/collections/index.js";
import type { ViewCapability } from "../auth/viewToken.js";

/** Parse a `read`/`write` capability list from a request body value.
 *  Anything else in the list is dropped rather than rejected — the result is
 *  then clamped against what the view itself declares, so a request can only
 *  ever narrow, never widen. */
export function parseCapabilities(value: unknown): ViewCapability[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const caps = value.filter((entry): entry is ViewCapability => entry === "read" || entry === "write");
  return caps.length > 0 ? caps : undefined;
}

/** Parse a comma-separated or repeated query param into a string list. */
export function parseListParam(value: unknown): string[] | undefined {
  const parts = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value.map(String) : [];
  const cleaned = parts.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Like `parseListParam` but VERBATIM — no trimming, no empty-entry removal.
 *  Callers on the frozen view-data contract depend on getting back exactly
 *  what was sent. */
export function csvParam(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string" && value.length > 0) return value.split(",");
  return undefined;
}

/** A single-valued query param (`?id=`, `?locale=`): the string only when it
 *  arrived exactly once, "" otherwise. A repeated param parses as an array,
 *  and stringifying that would forge an id/locale nobody asked for — reading
 *  it as absent lets the caller's own 404 / fallback answer instead. */
export function stringParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A request body is a record only if it is a plain object — an array would
 *  otherwise pass a bare `typeof === "object"` check and be written as a
 *  record with numeric keys. */
export function extractRecord(body: unknown): CollectionItem | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as CollectionItem;
}
