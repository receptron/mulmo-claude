// Shared runtime type guards for the Vue frontend (#520).
// Same API as server/utils/types.ts — kept in sync manually
// until a shared packages/types workspace is introduced.

/** Narrow `unknown` to a plain object (not null, not array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow `unknown` to any object (not null, arrays allowed). */
export function isObj(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** Non-empty string after trimming whitespace. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Record whose values are all strings. */
export function isStringRecord(
  value: unknown,
): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

/** String array (every element is a string). */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Error-like object with a `code` property. */
export function isErrorWithCode(
  value: unknown,
): value is { code: string; message?: string } {
  return isRecord(value) && typeof value.code === "string";
}

/** Check that a record has a specific key with a string value. */
export function hasStringProp<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, string> & Record<string, unknown> {
  return isRecord(value) && typeof value[key] === "string";
}

/** Check that a record has a specific key with a number value. */
export function hasNumberProp<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, number> & Record<string, unknown> {
  return isRecord(value) && typeof value[key] === "number";
}
