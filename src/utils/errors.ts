// Shared error helpers for the Vue side. Mirrors the server-side
// `server/utils/errors.ts` so the same helper is available wherever
// we handle caught exceptions.
//
// Use `errorMessage(err)` instead of inlining
// `err instanceof Error ? err.message : String(err)` — searching for
// one canonical helper is easier than grepping for the inline form.
//
// Non-Error objects with a `details` (gRPC convention) or `message`
// string field have that field surfaced — without this, gRPC errors
// like `{ code, details, metadata }` show up as `[object Object]`.
//
// The optional `fallback` covers the common idiom of surfacing a
// descriptive message ("Invalid JSON", "Connection error.") when a
// throw turns out to be a non-Error value.

export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  if (err !== null && typeof err === "object") {
    const obj = err as { details?: unknown; message?: unknown };
    if (typeof obj.details === "string" && obj.details) return obj.details;
    if (typeof obj.message === "string" && obj.message) return obj.message;
  }
  if (fallback !== undefined) return fallback;
  return String(err);
}
