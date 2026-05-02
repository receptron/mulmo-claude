// Auto-regenerate `conversations/memory/MEMORY.md` whenever a topic
// file is written via an app route (#1032).
//
// Wired into `publishFileChange` — the single chokepoint every
// route hits after a successful write. When the changed path looks
// like a topic file, this kicks off `regenerateTopicIndex` async
// so the index stays in sync with the bullets the user just edited
// in the file explorer.
//
// Limitation: the agent's raw `Write` tool bypasses app routes, so
// agent-driven edits do NOT trigger this hook. The prompt context
// re-reads disk every turn (`loadAllTopicFilesSync`), so the agent
// itself stays fresh; only the on-disk `MEMORY.md` lags between
// agent writes. Acceptable today — revisit if a periodic refresh
// proves needed.

import { workspacePath } from "../workspace.js";
import { regenerateTopicIndex } from "./topic-io.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import { MEMORY_TYPES } from "./types.js";
import { isSafeTopicSlug } from "./topic-types.js";

const TOPIC_PATH_PREFIXES: readonly string[] = MEMORY_TYPES.map((type) => `conversations/memory/${type}/`);

// Returns true iff the relative path points at a topic file —
// `conversations/memory/<type>/<slug>.md` where `<slug>` passes
// `isSafeTopicSlug` (the same shape gate the writer uses). Files at
// the memory root itself (e.g. `conversations/memory/MEMORY.md`,
// the index this helper writes) are excluded so the regen doesn't
// recurse on its own writes.
//
// Path is expected POSIX-normalised (the caller in `file-change.ts`
// already does this) and workspace-relative. We reject:
//   - absolute paths (`/foo` / `C:\\foo`)
//   - backslash-using paths (raw Windows separators)
//   - non-`.md` files
//   - dotdir subtrees (`.atomic-backup/`, `.archived/`)
//   - nested paths under a type subdir (the layout is flat)
//   - basenames that fail `isSafeTopicSlug` — same contract the
//     writer enforces, so a malformed file dropped manually under a
//     type subdir won't trigger a regen for an entry the loader
//     would later skip anyway.
export function isTopicFilePath(relativePath: string): boolean {
  if (typeof relativePath !== "string" || relativePath.length === 0) return false;
  if (relativePath.startsWith("/")) return false;
  if (relativePath.includes("\\")) return false;
  if (!relativePath.endsWith(".md")) return false;
  if (relativePath.includes("/.atomic-backup/")) return false;
  if (relativePath.includes("/.archived/")) return false;
  for (const prefix of TOPIC_PATH_PREFIXES) {
    if (!relativePath.startsWith(prefix)) continue;
    const tail = relativePath.slice(prefix.length);
    if (tail.includes("/")) return false;
    const slug = tail.slice(0, -".md".length);
    if (!isSafeTopicSlug(slug)) return false;
    return true;
  }
  return false;
}

/** Workspace-relative path to the index file the hook regenerates. */
export const TOPIC_INDEX_RELATIVE_PATH = "conversations/memory/MEMORY.md";

// Fire-and-forget index regeneration for a workspace-relative path.
// Returns `true` when a regen actually ran — callers (specifically
// `publishFileChange`) use this to decide whether to emit a follow-up
// change event for the index file itself, so an open `MEMORY.md` tab
// refreshes alongside the topic file the user just saved. Failures
// log and resolve `false`.
export async function maybeRegenerateTopicIndex(relativePath: string): Promise<boolean> {
  if (!isTopicFilePath(relativePath)) return false;
  try {
    await regenerateTopicIndex(workspacePath);
    log.debug("memory", "topic-index-hook: regenerated", { trigger: relativePath });
    return true;
  } catch (err) {
    log.warn("memory", "topic-index-hook: regenerate failed", {
      trigger: relativePath,
      error: errorMessage(err),
    });
    return false;
  }
}
