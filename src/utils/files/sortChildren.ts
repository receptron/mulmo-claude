import type { TreeNode } from "../../types/fileTree";
import type { FileSortMode } from "../../composables/useFileSortMode";

// Sort tree children: directories always come before files; within
// each group, "name" is locale-aware alphabetical and "recent" is
// newest-first by modifiedMs (missing mtimes sort last, then tie-break
// on name so the order is deterministic).
export function sortChildren(children: readonly TreeNode[], mode: FileSortMode): TreeNode[] {
  const copy = children.slice();
  copy.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    if (mode === "recent") {
      const am = a.modifiedMs ?? -Infinity;
      const bm = b.modifiedMs ?? -Infinity;
      if (am !== bm) return bm - am;
    }
    return a.name.localeCompare(b.name);
  });
  return copy;
}
