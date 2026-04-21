<template>
  <div class="h-full overflow-auto">
    <div v-if="filteredItems.length === 0" class="h-full flex items-center justify-center text-gray-400 text-sm">No items match the current filter</div>
    <table v-else class="min-w-full text-sm">
      <thead class="bg-gray-50 sticky top-0 z-10">
        <tr class="text-left text-xs font-medium text-gray-500 uppercase">
          <th v-for="col in COLUMNS" :key="col.key" class="px-3 py-2 cursor-pointer hover:bg-gray-100 select-none" @click="setSort(col.key)">
            {{ col.label }}
            <span v-if="sortKey === col.key" class="material-icons text-xs align-middle">{{ sortDir === "asc" ? "arrow_upward" : "arrow_downward" }}</span>
          </th>
          <th class="px-3 py-2"></th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-100">
        <template v-for="item in sortedItems" :key="item.id">
          <tr class="hover:bg-gray-50">
            <td class="px-3 py-2">
              <input type="checkbox" :checked="item.completed" @change="emit('toggleComplete', item)" />
            </td>
            <td class="px-3 py-2 max-w-md cursor-pointer" @click="toggleExpand(item.id)">
              <div :class="item.completed ? 'line-through text-gray-400' : 'text-gray-800'">
                {{ item.text }}
              </div>
              <div v-if="item.note" class="text-xs text-gray-400 truncate max-w-xs">
                {{ item.note }}
              </div>
            </td>
            <td class="px-3 py-2 text-xs text-gray-600">
              {{ statusLabel(item) }}
            </td>
            <td class="px-3 py-2">
              <span v-if="item.priority" class="px-1.5 py-0.5 rounded-full text-[10px] font-medium" :class="PRIORITY_CLASSES[item.priority]">{{
                PRIORITY_LABELS[item.priority]
              }}</span>
            </td>
            <td class="px-3 py-2">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="label in item.labels ?? []"
                  :key="label"
                  class="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                  :class="colorForLabel(label)"
                  >{{ label }}</span
                >
              </div>
            </td>
            <td class="px-3 py-2 text-xs">
              <span v-if="item.dueDate" class="px-1.5 py-0.5 rounded-full text-[10px] font-medium" :class="dueDateClasses(item.dueDate)">{{
                formatDueLabel(item.dueDate)
              }}</span>
            </td>
            <td class="px-3 py-2 text-xs text-gray-400">
              {{ formatShortDate(item.createdAt) }}
            </td>
            <td class="px-3 py-2 text-right">
              <button class="text-gray-300 hover:text-red-500 text-xs" title="Delete item" @click="emit('delete', item.id)">✕</button>
            </td>
          </tr>
          <tr v-if="expandedId === item.id">
            <td colspan="8" class="bg-blue-50 p-0">
              <TodoEditPanel :item="item" :columns="columns" @save="(input) => onSave(item.id, input)" @cancel="expandedId = null" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { StatusColumn, TodoItem } from "../../plugins/todo/index";
import { colorForLabel } from "../../plugins/todo/labels";
import { PRIORITY_CLASSES, PRIORITY_LABELS, PRIORITY_ORDER, dueDateClasses, formatDueLabel } from "../../plugins/todo/priority";
import type { PatchItemInput } from "../../plugins/todo/composables/useTodos";
import TodoEditPanel from "./TodoEditPanel.vue";
import { formatShortDate } from "../../utils/format/date";

type SortKey = "completed" | "text" | "status" | "priority" | "labels" | "dueDate" | "createdAt";
type SortDir = "asc" | "desc";

interface ColumnDef {
  key: SortKey;
  label: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "completed", label: "" },
  { key: "text", label: "Text" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "labels", label: "Labels" },
  { key: "dueDate", label: "Due" },
  { key: "createdAt", label: "Created" },
];

const props = defineProps<{
  filteredItems: TodoItem[];
  columns: StatusColumn[];
}>();

const emit = defineEmits<{
  patch: [id: string, input: PatchItemInput];
  delete: [id: string];
  toggleComplete: [item: TodoItem];
}>();

const sortKey = ref<SortKey>("createdAt");
const sortDir = ref<SortDir>("desc");
const expandedId = ref<string | null>(null);

function setSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortDir.value = key === "createdAt" ? "desc" : "asc";
  }
}

function toggleExpand(itemId: string): void {
  expandedId.value = expandedId.value === itemId ? null : itemId;
}

function onSave(itemId: string, input: PatchItemInput): void {
  emit("patch", itemId, input);
  expandedId.value = null;
}

function statusLabel(item: TodoItem): string {
  if (!item.status) return "";
  return props.columns.find((col) => col.id === item.status)?.label ?? "";
}

function compareValues(left: unknown, right: unknown): number {
  // Undefined sorts last regardless of direction so empty cells stay
  // at the bottom of the list (ascending) or top (descending — flipped
  // by the caller). This matches GitHub's "issues with no due date"
  // ordering, which I find the least surprising.
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") {
    return left === right ? 0 : left ? 1 : -1;
  }
  return String(left).localeCompare(String(right));
}

function sortValueOf(item: TodoItem, key: SortKey): unknown {
  switch (key) {
    case "completed":
      return item.completed;
    case "text":
      return item.text.toLowerCase();
    case "status":
      return statusLabel(item).toLowerCase();
    case "priority":
      return item.priority ? PRIORITY_ORDER[item.priority] : undefined;
    case "labels":
      return (item.labels ?? []).join(",").toLowerCase();
    case "dueDate":
      return item.dueDate;
    case "createdAt":
      return item.createdAt;
  }
}

const sortedItems = computed(() => {
  const list = [...props.filteredItems];
  list.sort((left, right) => {
    const result = compareValues(sortValueOf(left, sortKey.value), sortValueOf(right, sortKey.value));
    return sortDir.value === "asc" ? result : -result;
  });
  return list;
});
</script>
