// Canonical error helpers for the whole monorepo. Host (`server/`, `src/`)
// re-exports these rather than keeping its own copy — before #2217 the same
// function existed 14 times across 4 behaviours, and the two that mattered
// disagreed on gRPC-shaped errors: `{ code, details, metadata }` surfaced as
// "quota exceeded" through the host copy and as "[object Object]" through the
// core ones.
//
// `errorMessage` itself now lives in `@mulmoclaude/common` (browser-safe leaf,
// zero deps) so the Vue plugin surfaces can share the one implementation
// instead of hand-copying it — `@mulmoclaude/core/utils` is server-only and
// unreachable from browser code. This module keeps the same import surface so
// no core/host consumer of `errorMessage` breaks.
import { errorMessage } from "@mulmoclaude/common";

export { errorMessage };

// Coerce an unknown caught value into an Error, preserving the original if it
// already was one. Use in error boundaries / Promise rejections / event-handler
// onerror callbacks where the downstream API wants an Error object.
//
// `fallback` is the message used when coercing a non-Error value — pass a
// descriptive string for cases where `String(err)` would just produce noise
// (e.g. `<img>.onerror` hands you an Event, not the underlying load failure).
export function toError(err: unknown, fallback?: string): Error {
  if (err instanceof Error) return err;
  return new Error(fallback ?? errorMessage(err));
}
