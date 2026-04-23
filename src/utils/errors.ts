// Shared error helpers for the Vue side. Mirrors the server-side
// `server/utils/errors.ts` so the same helper is available wherever
// we handle caught exceptions.
//
// Use `errorMessage(err)` instead of inlining
// `err instanceof Error ? err.message : String(err)` — searching for
// one canonical helper is easier than grepping for the inline form.
//
// The optional `fallback` covers the common idiom of surfacing a
// descriptive message ("Invalid JSON", "Connection error.") when a
// throw turns out to be a non-Error value — otherwise `String(err)`
// yields noise like `[object Object]`.

export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  if (fallback !== undefined) return fallback;
  return String(err);
}
