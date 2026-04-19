// Shared runtime type guards. Previously duplicated in
// sources/fetchers/github.ts and sources/fetchers/rssParser.ts.

/** Narrow `unknown` to a plain object (not null, not array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
