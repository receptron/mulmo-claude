// #366: barrel for workspace file I/O. atomic = write-rename, safe = ENOENT-swallowing, json = sync read + atomic
// write, workspace-io = path resolve + I/O in one call.

export { writeFileAtomic, writeFileAtomicSync, type WriteAtomicOptions } from "./atomic.js";

export { isEnoent, readTextSafeSync, statSafe, statSafeAsync, readDirSafe, readDirSafeAsync, readTextOrNull, resolveWithinRoot } from "./safe.js";

export { loadJsonFile, writeJsonAtomic, readJsonOrNull } from "./json.js";

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

export * from "./session-io.js";
export * from "./todos-io.js";
export * from "./scheduler-io.js";
export * from "./html-io.js";
export * from "./reference-dirs-io.js";
export * from "./scheduler-overrides-io.js";
