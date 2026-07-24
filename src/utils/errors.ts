// Shared error helpers for the Vue side. Same implementation as the server —
// both re-export `@mulmoclaude/core/utils`, whose helpers are browser-safe
// (pure string work, no node imports). Keeping one implementation is what
// stops the gRPC `{ code, details, metadata }` case from printing as
// `[object Object]` on one side and "quota exceeded" on the other (#2217).
//
// Use `errorMessage(err)` instead of inlining
// `err instanceof Error ? err.message : String(err)`.
export { errorMessage, toError } from "@mulmoclaude/core/utils";
