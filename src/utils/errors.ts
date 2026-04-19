// Shared error helpers for the Vue side. Mirrors the server-side
// `server/utils/errors.ts` so the same helper is available wherever
// we handle caught exceptions.
//
// Use `errorMessage(err)` instead of inlining
// `err instanceof Error ? err.message : String(err)` — searching for
// one canonical helper is easier than grepping for the inline form.

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
