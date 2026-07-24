// Minimal JSON-over-REST fetch skeleton shared by the polling bridges
// (Rocket.Chat, Zulip), which used to carry byte-identical GET/POST wrappers.

import { isRecord } from "@mulmoclaude/common";

export type JsonRecord = Record<string, unknown>;

const MAX_ERROR_BODY_CHARS = 200;

/** Narrow a parsed JSON value to a record, defaulting non-objects to `{}` —
 *  the `isRecord(json) ? json : {}` idiom the REST bridges repeated so they
 *  never have to cast `JSON.parse` output. */
export function asJsonRecord(json: unknown): JsonRecord {
  return isRecord(json) ? json : {};
}

/** `fetch` + non-2xx guard + JSON-record narrow. Callers own the URL, auth
 *  headers, and timeout (via `init.signal`); `errorLabel` prefixes the thrown
 *  non-2xx error (e.g. "GET /im.list"). Network errors propagate from `fetch`
 *  unchanged, matching the callers' existing try/catch expectations. */
export async function fetchJsonRecord(url: string, init: RequestInit, errorLabel: string): Promise<JsonRecord> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${errorLabel}: ${res.status} ${text.slice(0, MAX_ERROR_BODY_CHARS)}`);
  }
  return asJsonRecord(await res.json());
}
