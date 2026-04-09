<template>
  <div>
    <button
      v-if="node.type === 'dir'"
      class="w-full flex items-center gap-1 px-2 py-1 text-left text-sm hover:bg-gray-100 rounded"
      @click="expanded = !expanded"
    >
      <span class="material-icons text-sm text-gray-400 shrink-0">{{
        expanded ? "folder_open" : "folder"
      }}</span>
      <span class="text-gray-700 truncate">{{
        node.name || "(workspace)"
      }}</span>
    </button>
    <button
      v-else
      class="w-full flex items-center gap-1 px-2 py-1 text-left text-sm rounded transition-colors"
      :class="
        selectedPath === node.path
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-700 hover:bg-gray-100'
      "
      :title="node.path"
      @click="emit('select', node.path)"
    >
      <span class="material-icons text-sm text-gray-400 shrink-0"
        >description</span
      >
      <span class="truncate">{{ node.name }}</span>
      <span
        v-if="isRecent"
        class="ml-auto w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"
        title="Recently changed"
      />
    </button>
    <div v-if="node.type === 'dir' && expanded && node.children" class="pl-4">
      <FileTree
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :selected-path="selectedPath"
        :recent-paths="recentPaths"
        @select="(p) => emit('select', p)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  modifiedMs?: number;
  children?: TreeNode[];
}

const props = defineProps<{
  node: TreeNode;
  selectedPath: string | null;
  recentPaths: Set<string>;
}>();

const emit = defineEmits<{
  select: [path: string];
}>();

// Only the root node defaults to expanded; nested directories start
// collapsed so opening Files mode doesn't render the entire workspace
// tree at once.
const expanded = ref(props.node.path === "");

const isRecent = computed(() => props.recentPaths.has(props.node.path));
</script>
