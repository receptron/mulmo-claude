<template>
  <div class="h-full overflow-x-auto overflow-y-hidden">
    <draggable
      :list="columnsLocal"
      item-key="id"
      group="todo-columns"
      handle=".col-handle"
      :animation="150"
      class="flex gap-3 h-full p-3 min-w-max"
      @end="onColumnDragEnd"
    >
      <template #item="{ element: col }: { element: StatusColumn }">
        <div :data-testid="`todo-column-${col.id}`" class="w-72 shrink-0 flex flex-col bg-gray-100 rounded-lg">
          <!-- Column header. The whole header is the drag handle —
             clicking the menu button still works because the menu
             button has its own @click handler that doesn't kick off
             a drag, but pressing-and-holding anywhere on the header
             starts a column drag. -->
          <div class="flex items-center justify-between px-3 py-2 border-b border-gray-200 col-handle cursor-grab active:cursor-grabbing">
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-2 h-2 rounded-full shrink-0" :class="col.isDone ? 'bg-green-500' : 'bg-gray-400'" />
              <span v-if="renamingId !== col.id" class="font-semibold text-sm text-gray-700 truncate" :title="col.label">{{ col.label }}</span>
              <input
                v-else
                ref="renameInput"
                v-model="renameDraft"
                class="px-1 py-0.5 text-sm bg-white border border-blue-400 rounded w-32"
                @keydown.enter="commitRename(col.id)"
                @keydown.escape="renamingId = null"
                @blur="commitRename(col.id)"
              />
              <span class="text-xs text-gray-500 shrink-0">{{ itemsByColumn(col.id).length }}</span>
            </div>
            <div class="relative">
              <button class="text-gray-400 hover:text-gray-600 px-1" title="Column actions" @click="toggleMenu(col.id)">
                <span class="material-icons text-base">more_horiz</span>
              </button>
              <div
                v-if="menuOpenId === col.id"
                class="absolute right-0 top-6 z-20 bg-white border border-gray-200 rounded shadow-md text-xs w-40 py-1"
                @click.stop
              >
                <button class="w-full text-left px-3 py-1.5 hover:bg-gray-50" @click="startRename(col)">Rename</button>
                <button class="w-full text-left px-3 py-1.5 hover:bg-gray-50" @click="markAsDone(col.id)">
                  {{ col.isDone ? "Already done column" : "Mark as done column" }}
                </button>
                <button class="w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50" @click="deleteColumn(col.id)">Delete column</button>
              </div>
            </div>
          </div>

          <!-- Cards -->
          <draggable
            :model-value="itemsByColumn(col.id)"
            item-key="id"
            group="todos"
            class="flex-1 overflow-y-auto p-2 space-y-2 min-h-[2rem]"
            :animation="150"
            @change="(e: DragChangeEvent) => onDragChange(col.id, e)"
          >
            <template #item="{ element }: { element: TodoItem }">
              <div
                :data-testid="`todo-card-${element.id}`"
                class="bg-white border border-l-4 border-gray-200 rounded shadow-sm p-2 cursor-grab hover:shadow active:cursor-grabbing"
                :class="element.priority ? PRIORITY_BORDER[element.priority] : 'border-l-gray-200'"
                @click="emit('open', element)"
              >
                <div class="flex items-start gap-2">
                  <input
                    type="checkbox"
                    :checked="element.completed"
                    class="mt-0.5 cursor-pointer shrink-0"
                    @click.stop
                    @change="emit('toggleComplete', element)"
                  />
                  <div class="flex-1 min-w-0">
                    <div class="text-sm" :class="element.completed ? 'line-through text-gray-400' : 'text-gray-800'">
                      {{ element.text }}
                    </div>
                    <div v-if="element.note" class="text-[11px] text-gray-400 mt-0.5 line-clamp-2">
                      {{ element.note }}
                    </div>
                    <div v-if="(element.labels && element.labels.length > 0) || element.priority || element.dueDate" class="flex flex-wrap gap-1 mt-1.5">
                      <span v-if="element.priority" class="px-1.5 py-0.5 rounded-full text-[10px] font-medium" :class="PRIORITY_CLASSES[element.priority]">{{
                        PRIORITY_LABELS[element.priority]
                      }}</span>
                      <span v-if="element.dueDate" class="px-1.5 py-0.5 rounded-full text-[10px] font-medium" :class="dueDateClasses(element.dueDate)">{{
                        formatDueLabel(element.dueDate)
                      }}</span>
                      <span
                        v-for="label in element.labels ?? []"
                        :key="label"
                        class="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                        :class="colorForLabel(label)"
                        >{{ label }}</span
                      >
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </draggable>

          <!-- Add card stub -->
          <button class="m-2 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded py-1.5 transition-colors" @click="emit('quickAdd', col.id)">
            + Add card
          </button>
        </div>
      </template>
    </draggable>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import draggable from "vuedraggable";
import type { StatusColumn, TodoItem } from "../../plugins/todo/index";
import { colorForLabel } from "../../plugins/todo/labels";
import { PRIORITY_BORDER, PRIORITY_CLASSES, PRIORITY_LABELS, dueDateClasses, formatDueLabel } from "../../plugins/todo/priority";

// vuedraggable @change event shape. The library emits one of these
// three keys depending on whether the move was within the same list,
// added from another list, or removed from the current list. We only
// react to "added" (the destination column) and "moved" (reorder
// within a single column) — "removed" is the source side and is
// always paired with an "added" on the destination, so handling it
// would double the API calls.
interface DragChangeEvent {
  added?: { newIndex: number; element: TodoItem };
  moved?: { newIndex: number; oldIndex: number; element: TodoItem };
  removed?: { oldIndex: number; element: TodoItem };
}

const props = defineProps<{
  filteredItems: TodoItem[];
  columns: StatusColumn[];
}>();

const emit = defineEmits<{
  move: [id: string, statusId: string, position: number];
  open: [item: TodoItem];
  toggleComplete: [item: TodoItem];
  quickAdd: [statusId: string];
  renameColumn: [id: string, label: string];
  deleteColumn: [id: string];
  markDone: [id: string];
  reorderColumns: [ids: string[]];
}>();

// Local mirror of props.columns so vuedraggable can reorder it in
// place (`:list` mode mutates the bound array). When the parent
// updates props.columns — either after we successfully persist a
// reorder, or because some other action changed the column set —
// we copy the new array in. This also rolls the kanban back if the
// API call fails: the parent's columns ref stays at the old order,
// the watch fires, and columnsLocal snaps back.
const columnsLocal = ref<StatusColumn[]>([...props.columns]);
watch(
  () => props.columns,
  (next) => {
    columnsLocal.value = [...next];
  },
);

function onColumnDragEnd(): void {
  const before = props.columns.map((c) => c.id);
  const after = columnsLocal.value.map((c) => c.id);
  // No-op drops: avoid an unnecessary network round-trip when the
  // drop position equals the original.
  if (before.length === after.length && before.every((id, i) => id === after[i])) {
    return;
  }
  emit("reorderColumns", after);
}

// Group filtered items by status, sorted by `order`. Computed so the
// kanban re-derives whenever items / filter changes.
const itemsByStatus = computed(() => {
  const map = new Map<string, TodoItem[]>();
  for (const col of props.columns) map.set(col.id, []);
  for (const item of props.filteredItems) {
    const id = item.status ?? props.columns[0]?.id;
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push(item);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  return map;
});

function itemsByColumn(id: string): TodoItem[] {
  return itemsByStatus.value.get(id) ?? [];
}

function onDragChange(columnId: string, event: DragChangeEvent): void {
  if (event.added) {
    emit("move", event.added.element.id, columnId, event.added.newIndex);
    return;
  }
  if (event.moved) {
    emit("move", event.moved.element.id, columnId, event.moved.newIndex);
  }
}

// ── Column menu / rename ─────────────────────────────────────────

const menuOpenId = ref<string | null>(null);
const renamingId = ref<string | null>(null);
const renameDraft = ref("");
const renameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null);

function toggleMenu(id: string): void {
  menuOpenId.value = menuOpenId.value === id ? null : id;
}

function startRename(col: StatusColumn): void {
  menuOpenId.value = null;
  renamingId.value = col.id;
  renameDraft.value = col.label;
  void nextTick(() => {
    const inputRef = renameInput.value;
    const el = Array.isArray(inputRef) ? inputRef[0] : inputRef;
    el?.focus();
    el?.select();
  });
}

function commitRename(id: string): void {
  if (renamingId.value !== id) return;
  const next = renameDraft.value.trim();
  renamingId.value = null;
  if (next.length === 0) return;
  const current = props.columns.find((c) => c.id === id);
  if (!current || current.label === next) return;
  emit("renameColumn", id, next);
}

function deleteColumn(id: string): void {
  menuOpenId.value = null;
  emit("deleteColumn", id);
}

function markAsDone(id: string): void {
  menuOpenId.value = null;
  emit("markDone", id);
}
</script>
