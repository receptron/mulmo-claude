// Thin host binding over the shared `manageCollection` tool
// (@mulmoclaude/core/collection/server — see manageTool.ts there for the
// full contract). Only the host specifics live here:
//   - bundledHelpsDir: workspace-setup's helpsAssetDir (ESM-only module,
//     so the core tool takes it injected rather than importing it),
//   - ablateValidation from this host's evaluation env, and
//   - the post-putSchema refresh (scheduled skills, user tasks and a
//     newly declared calendar's first sync are MulmoClaude-side state a
//     schema edit can change; the refreshers are the same ones
//     /api/config/refresh wraps, loaded lazily to keep this module's
//     static import graph light).
// The re-exported factory pre-binds bundledHelpsDir so tests keep the
// pre-extraction contract (tmpdir workspace, bundled schemaDocs fallback).

import { makeManageCollectionTool as makeCoreTool, type ManageCollectionDeps } from "@mulmoclaude/core/collection/server";
import { helpsAssetDir } from "@mulmoclaude/core/workspace-setup";
// The leaf module, NOT `../config.js` — that one imports this directory's
// `index.js`, so reaching into it from a tool closes an import cycle.
import { CONTAINER_WORKSPACE_PATH } from "../containerPaths.js";
import { isAblated } from "../../system/env.js";

export {
  MAX_UNSELECTIVE_ITEMS,
  MAX_SCHEMA_ISSUES,
  MAX_PUT_ITEMS,
  MAX_PUT_LINT,
  MAX_ITEMS_FILE_BYTES,
  type ManageCollectionDeps,
  type PutItemsLint,
  type RejectedRow,
} from "@mulmoclaude/core/collection/server";

/** Best-effort post-write refresh. Discovery re-reads schema.json from
 *  disk on every call, so a failed refresh only delays the live UI
 *  update — never the data. */
async function defaultRefresh(): Promise<void> {
  const [{ refreshScheduledSkills }, { refreshUserTasks }, { startInitialCalendarSync }] = await Promise.all([
    import("../../workspace/skills/scheduler.js"),
    import("../../workspace/skills/user-tasks.js"),
    import("../../services/google/initialCalendarSync.js"),
  ]);
  // An edit can ADD a `googleCalendar` block to an existing collection, which
  // is as much a "never synced" state as a fresh create (#2427). Fire-and-forget
  // inside the tool call — a first sync walks the whole calendar.
  startInitialCalendarSync();
  await Promise.all([refreshScheduledSkills(), refreshUserTasks()]);
}

/** The core factory with this host's bundled-docs dir and sandbox mount point
 *  pre-bound (both still overridable via deps, like every other injection).
 *
 *  `sandboxWorkspacePath` is bound unconditionally rather than from the sandbox
 *  env: when Docker is off the agent's paths are host paths and the prefix
 *  simply never matches, so reading the flag here would only add a way for the
 *  two to disagree. */
export function makeManageCollectionTool(deps: ManageCollectionDeps = {}): ReturnType<typeof makeCoreTool> {
  return makeCoreTool({ bundledHelpsDir: helpsAssetDir, sandboxWorkspacePath: CONTAINER_WORKSPACE_PATH, ...deps });
}

export const manageCollection = makeManageCollectionTool({
  ablateValidation: isAblated("validation") || undefined,
  refreshAfterWrite: defaultRefresh,
});
