// Composable: workspace file tree state + lazy loading.
// Extracted from FilesView.vue (#507 step 1).

import { ref } from "vue";
import type { TreeNode } from "../types/fileTree";
import { useExpandedDirs } from "./useExpandedDirs";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

export function useFileTree() {
  const { expand } = useExpandedDirs();

  const rootNode = ref<TreeNode | null>(null);
  const refRoots = ref<TreeNode[]>([]);
  const childrenByPath = ref<Map<string, TreeNode[] | null>>(new Map());
  const treeError = ref<string | null>(null);

  // Generation counter — incremented on reloadRoot so in-flight
  // requests from a prior generation don't write stale data.
  let generation = 0;

  async function loadDirChildren(path: string): Promise<void> {
    if (childrenByPath.value.has(path)) return;

    const gen = generation;
    const next = new Map(childrenByPath.value);
    next.set(path, null);
    childrenByPath.value = next;

    const result = await apiGet<TreeNode>(API_ROUTES.files.dir, { path });
    // Bail if reloadRoot was called while we were awaiting.
    if (gen !== generation) return;
    if (!result.ok) {
      const rollback = new Map(childrenByPath.value);
      rollback.delete(path);
      childrenByPath.value = rollback;
      treeError.value = result.error || `dir: ${result.status}`;
      return;
    }
    const node = result.data;
    const updated = new Map(childrenByPath.value);
    updated.set(path, node.children ?? []);
    childrenByPath.value = updated;
    if (path === "") rootNode.value = { ...node, children: [] };
  }

  async function ensureAncestorsLoaded(filePath: string): Promise<void> {
    const parts = filePath.split("/").filter(Boolean);
    if (parts.length <= 1) return;
    const ancestors: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      ancestors.push(parts.slice(0, i).join("/"));
    }
    for (const dir of ancestors) {
      expand(dir);
      await loadDirChildren(dir);
    }
  }

  async function reloadRoot(): Promise<void> {
    generation++;
    rootNode.value = null;
    childrenByPath.value = new Map();
    treeError.value = null;
    await loadDirChildren("");
  }

  async function loadRefRoots(): Promise<void> {
    const result = await apiGet<TreeNode[]>(API_ROUTES.files.refRoots);
    if (result.ok && Array.isArray(result.data)) {
      refRoots.value = result.data;
    }
  }

  return {
    rootNode,
    refRoots,
    childrenByPath,
    treeError,
    loadDirChildren,
    ensureAncestorsLoaded,
    reloadRoot,
    loadRefRoots,
  };
}
