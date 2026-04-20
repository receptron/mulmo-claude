// TreeNode type — shared between FileTree.vue, FilesView.vue,
// and composables (useFileTree, useFileSelection).
// Extracted from FileTree.vue so .ts files can import it without
// depending on a .vue module (which tsc can't resolve).

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  modifiedMs?: number;
  children?: TreeNode[];
}
