// Consolidated workspace file I/O (#366).
//
// This barrel re-exports every public helper so call sites can do:
//
//   import { writeFileAtomic, readWorkspaceText } from "../utils/files/index.js";
//
// Grouped by concern:
//
//   atomic.ts        — write-then-rename primitives
//   safe.ts          — ENOENT-swallowing wrappers (stat, readdir, readText, resolveWithinRoot)
//   json.ts          — JSON read/write (sync legacy + async atomic)
//   workspace-io.ts  — workspace-aware helpers (path resolve + I/O in one call)

export {
  writeFileAtomic,
  writeFileAtomicSync,
  type WriteAtomicOptions,
} from "./atomic.js";

export {
  isEnoent,
  readTextSafeSync,
  statSafe,
  statSafeAsync,
  readDirSafe,
  readDirSafeAsync,
  readTextOrNull,
  resolveWithinRoot,
} from "./safe.js";

export {
  loadJsonFile,
  saveJsonFile,
  writeJsonAtomic,
  readJsonOrNull,
} from "./json.js";

export {
  resolveWorkspacePath,
  resolvePath,
  readWorkspaceText,
  readWorkspaceTextSync,
  readWorkspaceJson,
  readWorkspaceJsonSync,
  writeWorkspaceText,
  writeWorkspaceTextSync,
  writeWorkspaceJson,
  existsInWorkspace,
  ensureWorkspaceDir,
  readTextUnder,
  writeTextUnder,
  readdirUnder,
  statUnder,
  ensureDirUnder,
} from "./workspace-io.js";

// ── Domain I/O ──────────────────────────────────────────────────
export * from "./session-io.js";
export * from "./todos-io.js";
export * from "./scheduler-io.js";
export * from "./html-io.js";
export * from "./reference-dirs-io.js";
