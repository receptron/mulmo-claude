// Shared text helpers. Use these instead of re-implementing the
// same operation per file (#1306).
//
// `truncate` lives in `@mulmoclaude/core/utils` so the host, the collection
// engine and the Google engine share one implementation — the copies had
// already drifted on the `ellipsis.length >= max` guard (#2217). Re-exported
// (rather than repointing ~5 import sites) to keep `server/utils/text.ts` the
// one place host code looks for general string helpers.
//
// Why not in `format/`: these are general string operations, not
// presentation-layer formatters. Reserve `format/` for locale-aware
// or unit-aware display helpers.
export { truncate } from "@mulmoclaude/core/utils";
