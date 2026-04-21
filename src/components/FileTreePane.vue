<template>
  <div class="w-72 flex-shrink-0 border-r border-gray-200 overflow-y-auto p-2 bg-gray-50">
    <div v-if="treeError" class="p-2 text-xs text-red-600">
      {{ treeError }}
    </div>
    <div v-else-if="!rootNode" class="p-2 text-xs text-gray-400">Loading...</div>
    <FileTree
      v-else
      :node="rootNode"
      :selected-path="selectedPath"
      :recent-paths="recentPaths"
      :children-by-path="childrenByPath"
      @select="emit('select', $event)"
      @load-children="emit('loadChildren', $event)"
    />
    <template v-if="refRoots.length > 0">
      <div class="mt-2 pt-2 border-t border-gray-200 px-1 mb-1 flex items-center gap-1">
        <span class="text-[10px] font-semibold text-gray-400 uppercase">Reference</span>
        <span class="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-600">RO</span>
      </div>
      <FileTree
        v-for="refNode in refRoots"
        :key="refNode.path"
        :node="refNode"
        :selected-path="selectedPath"
        :recent-paths="emptySet"
        :children-by-path="childrenByPath"
        @select="emit('select', $event)"
        @load-children="emit('loadChildren', $event)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import FileTree from "./FileTree.vue";
import type { TreeNode } from "../types/fileTree";

defineProps<{
  rootNode: TreeNode | null;
  refRoots: TreeNode[];
  childrenByPath: Map<string, TreeNode[] | null>;
  treeError: string | null;
  selectedPath: string | null;
  recentPaths: Set<string>;
}>();

const emit = defineEmits<{
  select: [path: string];
  loadChildren: [path: string];
}>();

// Shared empty set for reference roots (they don't highlight recents).
const emptySet = new Set<string>();
</script>
