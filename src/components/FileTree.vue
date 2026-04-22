<template>
  <div>
    <button
      v-if="node.type === 'dir'"
      class="w-full flex items-center gap-1 px-2 py-1 text-left text-sm hover:bg-gray-100 rounded"
      :data-testid="`file-tree-dir-${node.name || 'root'}`"
      @click="onToggle"
    >
      <span class="material-icons text-sm text-gray-400 shrink-0">{{ expanded ? "folder_open" : "folder" }}</span>
      <span class="text-gray-700 truncate">{{ node.name || t("fileTree.workspace") }}</span>
    </button>
    <button
      v-else
      class="w-full flex items-center gap-1 px-2 py-1 text-left text-sm rounded transition-colors"
      :class="selectedPath === node.path ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'"
      :data-testid="`file-tree-file-${node.name}`"
      :title="node.path"
      @click="emit('select', node.path)"
    >
      <span class="material-icons text-sm text-gray-400 shrink-0">description</span>
      <span class="truncate">{{ node.name }}</span>
      <span v-if="isRecent" class="ml-auto w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" :title="t('fileTree.recentlyChanged')" />
    </button>
    <div v-if="node.type === 'dir' && expanded" class="pl-4">
      <!-- Loading state: children not in the cache yet. Rendered
           once per dir so a slow network shows where the wait is,
           not as a global overlay. -->
      <div v-if="loadingChildren" class="px-2 py-1 text-xs text-gray-400">{{ t("common.loading") }}</div>
      <FileTree
        v-for="child in loadedChildren"
        :key="child.path"
        :node="child"
        :selected-path="selectedPath"
        :recent-paths="recentPaths"
        :children-by-path="childrenByPath"
        :sort-mode="sortMode"
        @select="(p) => emit('select', p)"
        @load-children="(p) => emit('loadChildren', p)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useExpandedDirs } from "../composables/useExpandedDirs";
import { sortChildren } from "../utils/files/sortChildren";
import type { FileSortMode } from "../composables/useFileSortMode";

const { t } = useI18n();

// TreeNode lives in src/types/fileTree.ts so .ts composables can
// import it without depending on a .vue module. Re-export here so
// existing `import { TreeNode } from "./FileTree.vue"` keeps working.
export type { TreeNode } from "../types/fileTree";
import type { TreeNode } from "../types/fileTree";

const props = defineProps<{
  node: TreeNode;
  selectedPath: string | null;
  recentPaths: Set<string>;
  // Lazy-expand cache managed by the parent (FilesView). `undefined`
  // entry (not in the map) = not loaded yet → we emit `loadChildren`
  // so the parent kicks off the fetch. `null` = load in flight →
  // show spinner. Array = loaded.
  childrenByPath: Map<string, TreeNode[] | null>;
  sortMode: FileSortMode;
}>();

const emit = defineEmits<{
  select: [path: string];
  loadChildren: [path: string];
}>();

// Expand/collapse state lives in a module-level singleton so every
// recursive FileTree instance shares it, and survives remounts (e.g.
// the agent-run refresh that bumps filesRefreshToken in FilesView).
// Default on first run: only the workspace root ("") is expanded.
const { isExpanded, toggle } = useExpandedDirs();
const expanded = computed(() => isExpanded(props.node.path));

const cached = computed(() => props.childrenByPath.get(props.node.path));
// `cached === null` = load in flight. `undefined` = never requested.
// Array = loaded.
const loadingChildren = computed(() => cached.value === null);
const loadedChildren = computed(() => (Array.isArray(cached.value) ? sortChildren(cached.value, props.sortMode) : []));

// Kick off a fetch if the dir is expanded but its children haven't
// been requested yet. Covers two scenarios:
//   1. User just toggled open → onToggle already emits, but watching
//      here makes the flow idempotent when the parent re-mounts the
//      component with expand state restored from localStorage.
//   2. Deep link: FilesView calls `expand(ancestor)` before children
//      arrive; this watcher catches that case too.
watch(
  [expanded, cached],
  ([isOpen, current]) => {
    if (!isOpen) return;
    if (props.node.type !== "dir") return;
    if (current !== undefined) return;
    emit("loadChildren", props.node.path);
  },
  { immediate: true },
);

function onToggle(): void {
  toggle(props.node.path);
  // When newly-opened, request children if cache miss. The watcher
  // above covers the reactive path but we also fire here so the
  // request is visibly tied to the click for network inspection.
  if (!isExpanded(props.node.path)) return;
  if (cached.value !== undefined) return;
  emit("loadChildren", props.node.path);
}

const isRecent = computed(() => props.recentPaths.has(props.node.path));
</script>
