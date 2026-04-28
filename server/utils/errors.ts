// Shared error helpers. Use `errorMessage(err)` instead of inlining
// `err instanceof Error ? err.message : String(err)` — searching for
// one canonical helper is easier than grepping for the inline form.
//
// Non-Error objects with a `details` (gRPC convention) or `message`
// string field have that field surfaced — without this, gRPC errors
// like `{ code, details, metadata }` show up to users as
// `[object Object]`.
//
// The optional `fallback` covers the common route-handler idiom where
// a throw of a plain non-Error value should surface as a descriptive
// message ("rebuild failed") rather than `String(err)` noise. Prefer
// passing a fallback at error-response boundaries — omit it for
// logging contexts where `String(err)` is fine.

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
