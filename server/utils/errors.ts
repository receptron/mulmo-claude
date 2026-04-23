// Shared error helpers. Use `errorMessage(err)` instead of inlining
// `err instanceof Error ? err.message : String(err)` — searching for
// one canonical helper is easier than grepping for the inline form.
//
// The optional `fallback` covers the common route-handler idiom where
// a throw of a plain non-Error value should surface as a descriptive
// message ("rebuild failed") rather than `String(err)` noise like
// `[object Object]`. Prefer passing a fallback at error-response
// boundaries — omit it for logging contexts where `String(err)` is
// fine.

export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  if (fallback !== undefined) return fallback;
  return String(err);
}
