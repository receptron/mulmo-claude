// Format detection for the memory storage layer (#1070 PR-B).
//
// Two layouts can live at `<workspaceRoot>/conversations/memory/`:
//
//   atomic (#1029): flat `<type>_<slug>.md` files at the memory
//     dir root, one fact per file.
//   topic (#1070):  `<type>/<topic>.md` under per-type subdirs,
//     one topic per file.
//
// Detection signal: topic format is active iff a canonical type
// subdir (`preference/` / `interest/` / `fact/` / `reference/`)
// exists under live `conversations/memory/`. The post-swap state.
//
// Special case for the swap window: `swapStagingIntoMemory` first
// renames `memory/` out of the way and then renames `memory.next/`
// into place. Inside that gap `memory/` does not exist at all, so
// requests would otherwise fall back to atomic format and write
// `<type>_<slug>.md` into the newly promoted topic tree (later
// topic-mode reads silently ignore those). To bridge the gap, we
// also accept `memory.next/<type>/` — but ONLY when `memory/` is
// entirely absent (the actual swap window). When `memory/` still
// exists with atomic files (staging-in-progress, before the swap),
// `memory.next/<type>/` is just the clusterer filling staging and
// must NOT flip detection to topic mode — atomic data is still
// authoritative and the prompt has to keep reading it.
// (#1076 / #1087 follow-up — review on prompt-routing regression.)
//
// The check is cheap (one stat per type plus a stat on `memory/`)
// and reflects on-disk truth, so a manual swap immediately changes
// behavior on the next request — no module-level cache.

import { statSync } from "node:fs";
import path from "node:path";

import { WORKSPACE_DIRS } from "../paths.js";
import { MEMORY_TYPES } from "./types.js";

function isDirectorySafe(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    // ENOENT / EACCES → treat as missing.
    return false;
  }
}

function hasAnyTypeSubdir(root: string): boolean {
  for (const type of MEMORY_TYPES) {
    if (isDirectorySafe(path.join(root, type))) return true;
  }
  return false;
}

export function hasTopicFormat(workspaceRoot: string): boolean {
  const memoryRoot = path.join(workspaceRoot, WORKSPACE_DIRS.memoryDir);
  // Live tree wins: any `memory/<type>/` → post-swap topic mode.
  if (hasAnyTypeSubdir(memoryRoot)) return true;
  // If live `memory/` still exists (with atomic files at the root,
  // or empty), the staging dir is just being filled — atomic format
  // is still authoritative until the swap renames memory/ out of
  // the way. Don't let `memory.next/<type>/` flip detection here.
  if (isDirectorySafe(memoryRoot)) return false;
  // Live tree absent → could be the swap window OR a fresh
  // workspace. Consult staging.
  const stagingRoot = path.join(workspaceRoot, WORKSPACE_DIRS.memoryStaging);
  return hasAnyTypeSubdir(stagingRoot);
}
