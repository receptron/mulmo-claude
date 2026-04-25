<template>
  <div class="w-72 flex-shrink-0 border-r border-gray-200 overflow-y-auto p-2 bg-gray-50">
    <div class="flex justify-end items-center gap-2 pb-1 text-xs">
      <span class="text-gray-400">{{ t("fileTreePane.sort") }}</span>
      <div class="flex border border-gray-300 rounded overflow-hidden">
        <button
          type="button"
          class="h-8 px-2.5 flex items-center gap-1 transition-colors"
          :class="sortMode === 'name' ? 'bg-blue-50 text-blue-700 font-medium' : 'bg-white text-gray-500 hover:bg-gray-50'"
          :aria-pressed="sortMode === 'name'"
          :title="t('fileTreePane.sortByName')"
          data-testid="file-sort-name"
          @click="emit('update:sortMode', 'name')"
        >
          {{ t("fileTreePane.name") }}
        </button>
        <button
          type="button"
          class="h-8 px-2.5 flex items-center gap-1 transition-colors"
          :class="sortMode === 'recent' ? 'bg-blue-50 text-blue-700 font-medium' : 'bg-white text-gray-500 hover:bg-gray-50'"
          :aria-pressed="sortMode === 'recent'"
          :title="t('fileTreePane.sortByRecent')"
          data-testid="file-sort-recent"
          @click="emit('update:sortMode', 'recent')"
        >
          {{ t("fileTreePane.recent") }}
        </button>
      </div>
    </div>
    <div v-if="treeError" class="p-2 text-xs text-red-600">
      {{ treeError }}
    </div>
    <div v-else-if="!rootNode" class="p-2 text-xs text-gray-400">{{ t("common.loading") }}</div>
    <FileTree
      v-else
      :node="rootNode"
      :selected-path="selectedPath"
      :recent-paths="recentPaths"
      :children-by-path="childrenByPath"
      :sort-mode="sortMode"
      @select="emit('select', $event)"
      @load-children="emit('loadChildren', $event)"
    />
    <template v-if="refRoots.length > 0">
      <div class="mt-2 pt-2 border-t border-gray-200 px-1 mb-1 flex items-center gap-1">
        <span class="text-[10px] font-semibold text-gray-400 uppercase">{{ t("fileTreePane.reference") }}</span>
        <span class="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-600">{{ t("fileTreePane.readOnlyBadge") }}</span>
      </div>
      <FileTree
        v-for="refNode in refRoots"
        :key="refNode.path"
        :node="refNode"
        :selected-path="selectedPath"
        :recent-paths="emptySet"
        :children-by-path="childrenByPath"
        :sort-mode="sortMode"
        @select="emit('select', $event)"
        @load-children="emit('loadChildren', $event)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import FileTree from "./FileTree.vue";
import type { TreeNode } from "../types/fileTree";
import type { FileSortMode } from "../composables/useFileSortMode";

const { t } = useI18n();

defineProps<{
  rootNode: TreeNode | null;
  refRoots: TreeNode[];
  childrenByPath: Map<string, TreeNode[] | null>;
  treeError: string | null;
  selectedPath: string | null;
  recentPaths: Set<string>;
  sortMode: FileSortMode;
}>();

const emit = defineEmits<{
  select: [path: string];
  loadChildren: [path: string];
  "update:sortMode": [mode: FileSortMode];
}>();

// Shared empty set for reference roots (they don't highlight recents).
const emptySet = new Set<string>();
</script>
