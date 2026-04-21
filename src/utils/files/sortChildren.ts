import type { TreeNode } from "../../types/fileTree";
import type { FileSortMode } from "../../composables/useFileSortMode";

// Sort tree children: directories always come before files; within
// each group, "name" is locale-aware alphabetical and "recent" is
// newest-first by modifiedMs (missing mtimes sort last, then tie-break
// on name so the order is deterministic).
export function sortChildren(children: readonly TreeNode[], mode: FileSortMode): TreeNode[] {
  const copy = children.slice();
  copy.sort((nodeA, nodeB) => {
    if (nodeA.type !== nodeB.type) return nodeA.type === "dir" ? -1 : 1;
    if (mode === "recent") {
      const modTimeA = nodeA.modifiedMs ?? -Infinity;
      const modTimeB = nodeB.modifiedMs ?? -Infinity;
      if (modTimeA !== modTimeB) return modTimeB - modTimeA;
    }
    return nodeA.name.localeCompare(nodeB.name);
  });
  return copy;
}
