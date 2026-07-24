// General-purpose runtime type guards, shared across the MulmoClaude host,
// bridges, and plugins. This is a leaf package — pure and dependency-free — so
// any tier can import it without creating an uphill edge.
//
// These originated as `server/utils/types.ts` (#504), which centralised 40+
// hand-written inline `typeof x === "object"` checks. They are promoted here so
// the same guards stop being re-hand-written in every bridge and plugin too.

/** Narrow `unknown` to a plain object (not null, not array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow `unknown` to any object (not null, arrays allowed).
 *  Use `isRecord` when you need to access string keys. */
export function isObj(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** Non-empty string after trimming whitespace. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Record whose values are all strings. */
export function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((val) => typeof val === "string");
}

/** String array (every element is a string). */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((val) => typeof val === "string");
}

/** An array of unknowns. Prefer this over a bare `Array.isArray` in typed code:
 *  `Array.isArray(x: unknown)` narrows to `any[]`, silently reintroducing
 *  `any`, whereas this keeps the element type `unknown`. */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Error-like object with a `code` property (e.g. Node.js fs errors). */
export function isErrorWithCode(value: unknown): value is { code: string; message?: string } {
  return isRecord(value) && typeof value.code === "string";
}

/** Check that a record has a specific key with a string value. */
export function hasStringProp<K extends string>(value: unknown, key: K): value is Record<K, string> & Record<string, unknown> {
  return isRecord(value) && typeof value[key] === "string";
}

/** Check that a record has a specific key with a number value. */
export function hasNumberProp<K extends string>(value: unknown, key: K): value is Record<K, number> & Record<string, unknown> {
  return isRecord(value) && typeof value[key] === "number";
}

/** Split a comma-separated env value into trimmed, non-empty entries.
 *  `lowercase` folds case for identifiers compared case-insensitively
 *  (JIDs, email addresses, hex pubkeys). Absent/empty input → empty list. */
export function parseCsvList(raw: string | undefined, opts?: { lowercase?: boolean }): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => (opts?.lowercase ? entry.trim().toLowerCase() : entry.trim()))
    .filter(Boolean);
}

/** A comma-separated env value as a Set — the canonical allowlist shape,
 *  where an empty set is the "allow all" sentinel (`set.size === 0`). */
export function parseCsvSet(raw: string | undefined, opts?: { lowercase?: boolean }): Set<string> {
  return new Set(parseCsvList(raw, opts));
}

/** Normalise an unknown thrown value into a human-readable string. Isomorphic
 *  (host, bridges, plugins, Vue) — this is the single home for the helper that
 *  #2217 could only consolidate for server code, since `@mulmoclaude/core/utils`
 *  is server-only.
 *
 *  A non-Error object with a non-empty string `details` (gRPC convention) or
 *  `message` field surfaces that field — `details` wins — instead of the
 *  `[object Object]` a bare `String(err)` would print; an empty-string field
 *  falls through. `fallback` covers the error-boundary idiom where a thrown
 *  non-Error should read as a descriptive message rather than `String(err)`
 *  noise; omit it in logging contexts where `String(err)` is fine. */
export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  if (hasStringProp(err, "details") && err.details) return err.details;
  if (hasStringProp(err, "message") && err.message) return err.message;
  if (fallback !== undefined) return fallback;
  return String(err);
}

/** `Date` → `YYYY-MM-DD` in UTC — for dates that must not shift with the
 *  host's local timezone (tool-trace search dirs, API date keys). Isomorphic
 *  single source (#2480): the host re-exports it from `server/utils/date.ts`,
 *  x-plugin imports it directly. The `@receptron/task-scheduler` copy stays
 *  local on purpose — that leaf package is published independently and kept
 *  dependency-free. Wall-clock questions use the host's `toLocalIsoDate`. */
export function toUtcIsoDate(timestamp: Date): string {
  const year = timestamp.getUTCFullYear();
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, "0");
  const day = String(timestamp.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export { scanEnvOptions, snakeToLowerCamel, type ScanEnvOptionsConfig } from "./envScan.js";
