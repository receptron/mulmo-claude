// Shared error helpers. Use `errorMessage(err)` instead of inlining
// `err instanceof Error ? err.message : String(err)` — searching for
// one canonical helper is easier than grepping for the inline form.
//
// The implementation lives in `@mulmoclaude/core/utils` so the host, the
// collection engine, the scheduler and the Google engine can't drift apart
// again: before #2217 this function existed 14 times across 4 behaviours, and
// gRPC-shaped errors surfaced as "[object Object]" through half of them.
// Re-exported (rather than repointing 92 files) so host code keeps reaching
// for `server/utils/errors.js` by name.
export { errorMessage } from "@mulmoclaude/core/utils";
