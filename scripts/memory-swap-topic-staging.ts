// Manual escape hatch that promotes a topic-format staging into
// `conversations/memory/` (#1070 PR-B). Invoked via
// `yarn memory:swap`.
//
// Normal flow does NOT need this: `runTopicMigrationOnce` now
// auto-swaps after a successful cluster, so `memory.next/` is
// short-lived in practice. This script stays as a fallback for two
// scenarios:
//   1. The auto-swap failed (e.g. permission glitch) and staging is
//      sitting around from a prior server start.
//   2. The user manually edited `memory.next/` and wants to promote
//      their tweaked tree.
//
// `topic-swap.ts` parks the prior atomic layout under
// `conversations/memory/.atomic-backup/<ts>/` so a misclassified
// migration can be rolled back by hand.
//
// CLEANUP 2026-07-01: see `server/workspace/memory/topic-run.ts`
// — this script is part of the one-shot atomic → topic migration
// chain and goes when the chain goes (along with the
// `yarn memory:swap` script entry in package.json).

import { workspacePath } from "../server/workspace/workspace.js";
import { swapStagingIntoMemory } from "../server/workspace/memory/topic-swap.js";

async function main(): Promise<void> {
  const result = await swapStagingIntoMemory(workspacePath);
  if (!result.swapped) {
    console.error(`memory:swap — did not swap: ${result.reason ?? "unknown"}`);
    process.exitCode = 1;
    return;
  }
  console.log(`memory:swap — promoted staging into conversations/memory/`);
  if (result.backupPath) {
    console.log(`memory:swap — prior atomic layout parked at ${result.backupPath}`);
  } else {
    console.log("memory:swap — no prior memory dir existed; nothing to back up");
  }
}

main().catch((err) => {
  console.error(`memory:swap — failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
