// Entry point for `@mulmoclaude/core/files` (server-only). The single source of
// truth for the safety-critical file primitives shared by the host, core, and
// plugins: atomic file I/O — tmp-write + rename, with the Windows retry loop —
// lives in exactly one place (#2399), and so does the realpath-based
// path-containment check (#2461). Internal-only helpers (isTransientRenameError,
// renameWithWindowsRetry) stay off this barrel and are imported from ./atomic by tests.
export { writeFileAtomic, writeFileAtomicSync, type WriteAtomicOptions } from "./atomic.js";
export { writeJsonAtomic } from "./json.js";
export { isEnoent, resolveWithinRoot } from "./safe.js";
