<template>
  <div class="h-full overflow-y-auto p-4">
    <div v-if="filteredItems.length === 0" class="h-full flex items-center justify-center text-gray-400 text-sm">No items match the current filter</div>
    <ul v-else class="space-y-2 max-w-3xl mx-auto">
      <li v-for="item in filteredItems" :key="item.id" class="rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
        <div class="flex items-center gap-3 p-3 cursor-pointer group" @click="toggleExpand(item.id)">
          <input type="checkbox" :checked="item.completed" class="cursor-pointer shrink-0" @click.stop @change="toggleComplete(item)" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm" :class="item.completed ? 'line-through text-gray-400' : 'text-gray-800'">{{ item.text }}</span>
              <span v-if="statusLabel(item)" class="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">{{ statusLabel(item) }}</span>
              <span v-if="item.priority" class="px-1.5 py-0.5 rounded-full text-[10px] font-medium" :class="PRIORITY_CLASSES[item.priority]">{{
                PRIORITY_LABELS[item.priority]
              }}</span>
              <span v-if="item.dueDate" class="px-1.5 py-0.5 rounded-full text-[10px] font-medium" :class="dueDateClasses(item.dueDate)">{{
                formatDueLabel(item.dueDate)
              }}</span>
              <span v-for="label in item.labels ?? []" :key="label" class="px-1.5 py-0.5 rounded-full text-[10px] font-medium" :class="colorForLabel(label)">{{
                label
              }}</span>
            </div>
            <div v-if="item.note" class="text-xs text-gray-400 mt-0.5">
              {{ item.note }}
            </div>
          </div>
          <button
            class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-1 shrink-0"
            title="Delete item"
            @click.stop="emit('delete', item.id)"
          >
            ✕
          </button>
        </div>
        <TodoEditPanel v-if="expandedId === item.id" :item="item" :columns="columns" @save="(input) => onSave(item.id, input)" @cancel="expandedId = null" />
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { StatusColumn, TodoItem } from "../../plugins/todo/index";
import { colorForLabel } from "../../plugins/todo/labels";
import { PRIORITY_CLASSES, PRIORITY_LABELS, dueDateClasses, formatDueLabel } from "../../plugins/todo/priority";
import type { PatchItemInput } from "../../plugins/todo/composables/useTodos";
import TodoEditPanel from "./TodoEditPanel.vue";

const props = defineProps<{
  filteredItems: TodoItem[];
  columns: StatusColumn[];
}>();

const emit = defineEmits<{
  patch: [id: string, input: PatchItemInput];
  delete: [id: string];
  toggleComplete: [item: TodoItem];
}>();

const expandedId = ref<string | null>(null);

function toggleExpand(itemId: string): void {
  expandedId.value = expandedId.value === itemId ? null : itemId;
}

function toggleComplete(item: TodoItem): void {
  emit("toggleComplete", item);
}

function onSave(itemId: string, input: PatchItemInput): void {
  emit("patch", itemId, input);
  expandedId.value = null;
}

function statusLabel(item: TodoItem): string {
  if (!item.status) return "";
  const col = props.columns.find((column) => column.id === item.status);
  return col?.label ?? "";
}
</script>
