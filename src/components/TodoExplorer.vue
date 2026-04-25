<template>
  <div class="h-full bg-white flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <h2 class="text-base font-semibold text-gray-800 shrink-0">{{ t("todoExplorer.heading") }}</h2>
        <span class="text-xs text-gray-500 shrink-0">{{ t("todoExplorer.doneRatio", { done: completedCount, total: items.length }) }}</span>
        <input
          v-model="search"
          data-testid="todo-search"
          type="text"
          :placeholder="t('todoExplorer.searchPlaceholder')"
          class="h-8 px-2.5 text-sm border border-gray-200 rounded w-44 focus:outline-none focus:border-blue-400"
        />
      </div>
      <div class="flex items-center gap-2">
        <!-- Add button -->
        <button
          data-testid="todo-add-btn"
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded bg-blue-500 text-white hover:bg-blue-600"
          @click="addOpen = true"
        >
          {{ t("todoExplorer.addButton") }}
        </button>
        <!-- Add column button (kanban only) -->
        <button
          v-if="viewMode === TODO_VIEW.kanban"
          data-testid="todo-column-add-btn"
          class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
          @click="addColumnOpen = true"
        >
          {{ t("todoExplorer.addColumnButton") }}
        </button>
        <!-- View mode toggle -->
        <div class="flex border border-gray-300 rounded overflow-hidden">
          <button
            v-for="mode in VIEW_MODES"
            :key="mode.key"
            class="h-8 w-8 flex items-center justify-center"
            :class="viewMode === mode.key ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'"
            :data-testid="`todo-view-${mode.key}`"
            :title="mode.label"
            @click="setViewMode(mode.key)"
          >
            <span class="material-icons text-sm">{{ mode.icon }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Label filter chips -->
    <div v-if="labelInventory.length > 0" class="flex flex-wrap items-center gap-1.5 px-4 py-1.5 border-b border-gray-100 bg-gray-50 shrink-0">
      <span class="text-[11px] text-gray-500 mr-1">{{ t("todoExplorer.labels") }}</span>
      <button
        v-for="entry in labelInventory"
        :key="entry.label"
        class="px-2 py-0.5 rounded-full text-[10px] font-medium transition-all"
        :class="
          activeFilters.has(entry.label.toLowerCase())
            ? 'ring-2 ring-blue-400 ' + colorForLabel(entry.label)
            : colorForLabel(entry.label) + ' opacity-70 hover:opacity-100'
        "
        @click="toggleFilter(entry.label)"
      >
        {{ entry.label }}
        <span class="opacity-60">{{ entry.count }}</span>
      </button>
      <button
        v-if="activeFilters.size > 0"
        class="ml-auto text-[11px] text-gray-500 hover:text-gray-700"
        :title="t('todoExplorer.clearFiltersTitle')"
        @click="clearFilters"
      >
        {{ t("todoExplorer.clearButton") }}
      </button>
    </div>

    <!-- Error banner -->
    <div v-if="error" class="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100 shrink-0">
      {{ error }}
    </div>

    <!-- Body -->
    <div class="flex-1 min-h-0">
      <div v-if="items.length === 0" class="h-full flex items-center justify-center text-gray-400 text-sm">{{ t("todoExplorer.emptyHint") }}</div>
      <template v-else>
        <TodoKanbanView
          v-if="viewMode === TODO_VIEW.kanban"
          :filtered-items="filteredItems"
          :columns="columns"
          @move="onMove"
          @open="onOpenItem"
          @toggle-complete="onToggleComplete"
          @quick-add="quickAddInColumn"
          @rename-column="onRenameColumn"
          @delete-column="onDeleteColumn"
          @mark-done="onMarkDone"
          @reorder-columns="onReorderColumns"
        />
        <TodoTableView
          v-else-if="viewMode === TODO_VIEW.table"
          :filtered-items="filteredItems"
          :columns="columns"
          @patch="onPatchItem"
          @delete="onDeleteItem"
          @toggle-complete="onToggleComplete"
        />
        <TodoListView
          v-else
          :filtered-items="filteredItems"
          :columns="columns"
          @patch="onPatchItem"
          @delete="onDeleteItem"
          @toggle-complete="onToggleComplete"
        />
      </template>
    </div>

    <!-- Add item dialog -->
    <TodoAddDialog v-if="addOpen" :columns="columns" :default-status="addDefaultStatus" @cancel="addOpen = false" @create="onCreateItem" />

    <!-- Edit item dialog (used by kanban click; list/table use the
         inline edit panel and don't need to open this) -->
    <TodoEditDialog
      v-if="editingItem"
      :item="editingItem"
      :columns="columns"
      @cancel="editingItem = null"
      @save="onEditDialogSave"
      @delete="onEditDialogDelete"
    />

    <!-- Add column dialog -->
    <div v-if="addColumnOpen" class="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" @click="addColumnOpen = false">
      <div class="bg-white rounded-lg shadow-xl w-80 p-5 space-y-3" role="dialog" aria-modal="true" aria-labelledby="todo-add-column-title" @click.stop>
        <h3 id="todo-add-column-title" class="text-base font-semibold text-gray-800">{{ t("todoExplorer.addColumn") }}</h3>
        <label class="block text-xs text-gray-600">
          {{ t("todoExplorer.newColumnLabelField") }}
          <input
            v-model="newColumnLabel"
            type="text"
            :placeholder="t('todoExplorer.newColumnPlaceholder')"
            class="mt-1 w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
            @keydown.enter="commitNewColumn"
          />
        </label>
        <div class="flex justify-end gap-2 pt-1">
          <button class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50" @click="addColumnOpen = false">
            {{ t("common.cancel") }}
          </button>
          <button class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600" @click="commitNewColumn">{{ t("common.add") }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { scrollIntoViewByTestId } from "../utils/dom/scrollIntoViewByTestId";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TodoData, TodoItem } from "../plugins/todo/index";
import { colorForLabel, filterByLabels, listLabelsWithCount } from "../plugins/todo/labels";
import { useTodos, type CreateItemInput, type PatchItemInput } from "../plugins/todo/composables/useTodos";
import TodoKanbanView from "./todo/TodoKanbanView.vue";
import TodoTableView from "./todo/TodoTableView.vue";
import TodoListView from "./todo/TodoListView.vue";
import TodoAddDialog from "./todo/TodoAddDialog.vue";
import TodoEditDialog from "./todo/TodoEditDialog.vue";
import { TODO_VIEW, TODO_VIEW_MODES as VIEW_MODES, type TodoViewMode as ViewMode } from "../plugins/todo/viewModes";

const { t } = useI18n();

const VIEW_MODE_KEY = "todo_explorer_view_mode";

const props = defineProps<{
  selectedResult?: ToolResultComplete<TodoData>;
}>();

const { items, columns, error, refresh, createItem, patchItem, moveItem, deleteItem, addColumn, patchColumn, deleteColumn, reorderColumns } = useTodos(
  props.selectedResult?.data?.items ?? [],
  props.selectedResult?.data?.columns ?? [],
);

// When the parent swaps in a different tool result, reseed the local
// state and re-fetch from the server. Watching the uuid (not items)
// so empty-result swaps still trigger.
watch(
  () => props.selectedResult?.uuid,
  () => {
    items.value = props.selectedResult?.data?.items ?? [];
    columns.value = props.selectedResult?.data?.columns ?? [];
    void refresh();
  },
);

// ── View mode (persisted in localStorage) ───────────────────────

const VALID_VIEW_MODES: ReadonlySet<string> = new Set(Object.values(TODO_VIEW));

function loadViewMode(): ViewMode {
  const stored = localStorage.getItem(VIEW_MODE_KEY);
  if (stored && VALID_VIEW_MODES.has(stored)) {
    return stored as ViewMode;
  }
  return TODO_VIEW.kanban;
}

const viewMode = ref<ViewMode>(loadViewMode());

function setViewMode(next: ViewMode): void {
  viewMode.value = next;
  localStorage.setItem(VIEW_MODE_KEY, next);
}

// ── Filtering ──────────────────────────────────────────────────

const search = ref("");
const activeFilters = ref<Set<string>>(new Set());

const labelInventory = computed(() => listLabelsWithCount(items.value));

function toggleFilter(label: string): void {
  const key = label.toLowerCase();
  const next = new Set(activeFilters.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  activeFilters.value = next;
}

function clearFilters(): void {
  activeFilters.value = new Set();
}

const filteredItems = computed(() => {
  const byLabels = filterByLabels(items.value, [...activeFilters.value]);
  const query = search.value.trim().toLowerCase();
  if (query.length === 0) return byLabels;
  return byLabels.filter((item) => {
    if (item.text.toLowerCase().includes(query)) return true;
    if (item.note?.toLowerCase().includes(query)) return true;
    return false;
  });
});

const completedCount = computed(() => items.value.filter((i) => i.completed).length);

// ── Add dialog ─────────────────────────────────────────────────

const addOpen = ref(false);
const addDefaultStatus = ref<string | undefined>(undefined);

function quickAddInColumn(statusId: string): void {
  addDefaultStatus.value = statusId;
  addOpen.value = true;
}

async function onCreateItem(input: CreateItemInput): Promise<void> {
  const created = await createItem(input);
  if (created) {
    addOpen.value = false;
    addDefaultStatus.value = undefined;
  }
}

// ── Add column dialog ──────────────────────────────────────────

const addColumnOpen = ref(false);
const newColumnLabel = ref("");

async function commitNewColumn(): Promise<void> {
  const label = newColumnLabel.value.trim();
  if (label.length === 0) return;
  const added = await addColumn({ label });
  if (added) {
    addColumnOpen.value = false;
    newColumnLabel.value = "";
  }
}

// Escape closes the inline add-column dialog. The Add and Edit
// dialogs handle their own Escape via document listeners; this one
// is owned by the explorer template directly so it lives here.
function onExplorerKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (addColumnOpen.value) {
    addColumnOpen.value = false;
  }
}
onMounted(() => document.addEventListener("keydown", onExplorerKeydown));
onUnmounted(() => document.removeEventListener("keydown", onExplorerKeydown));

// Permalink support (#762): arrivals on /todos/:itemId scroll and
// flash the matching card. Safe to run unconditionally — when the
// explorer is embedded in FilesView the URL has no :itemId and
// scrollIntoViewByTestId is a no-op. Retry a handful of times to
// cover the window between mount and the first items fetch landing.
const TODO_FOCUS_MAX_RETRIES = 10;
const TODO_FOCUS_RETRY_MS = 150;
const route = useRoute();

async function focusUrlItem(itemId: string): Promise<void> {
  for (let attempt = 0; attempt < TODO_FOCUS_MAX_RETRIES; attempt++) {
    await nextTick();
    if (scrollIntoViewByTestId(`todo-card-${itemId}`)) return;
    await new Promise((resolve) => window.setTimeout(resolve, TODO_FOCUS_RETRY_MS));
  }
}

onMounted(() => {
  const itemId = route.params.itemId;
  if (typeof itemId === "string" && itemId) {
    void focusUrlItem(itemId);
  }
});

watch(
  () => route.params.itemId,
  (itemId) => {
    if (typeof itemId === "string" && itemId) {
      void focusUrlItem(itemId);
    }
  },
);

// ── Item handlers ──────────────────────────────────────────────

function onPatchItem(itemId: string, input: PatchItemInput): void {
  void patchItem(itemId, input);
}

// Single confirm gate for every item deletion path: row "✕" buttons
// in list/table, the kanban edit dialog's delete button, anything
// else that wants to remove an item. Centralised so we never
// accidentally bypass the confirm in a future caller.
function confirmAndDelete(itemId: string): boolean {
  const item = items.value.find((i) => i.id === itemId);
  if (!item) return false;
  const confirmed = window.confirm(`Delete "${item.text}"?`);
  if (!confirmed) return false;
  void deleteItem(itemId);
  return true;
}

function onDeleteItem(itemId: string): void {
  confirmAndDelete(itemId);
}

function onToggleComplete(item: TodoItem): void {
  void patchItem(item.id, { completed: !item.completed });
}

function onMove(itemId: string, statusId: string, position: number): void {
  void moveItem(itemId, { status: statusId, position });
}

// ── Edit dialog (kanban click) ─────────────────────────────────

const editingItem = ref<TodoItem | null>(null);

function onOpenItem(item: TodoItem): void {
  // Kanban cards open the modal edit dialog. List and Table views
  // have their own inline edit panels and don't go through here.
  editingItem.value = item;
}

async function onEditDialogSave(input: PatchItemInput): Promise<void> {
  const target = editingItem.value;
  if (!target) return;
  const saved = await patchItem(target.id, input);
  if (saved) editingItem.value = null;
}

function onEditDialogDelete(itemId: string): void {
  // Funnel through the same confirm gate as the inline ✕ buttons.
  // The dialog only closes if the user confirmed; if they cancelled
  // the confirm, the dialog stays open so they can keep editing.
  if (confirmAndDelete(itemId)) editingItem.value = null;
}

// ── Column handlers ────────────────────────────────────────────

function onRenameColumn(columnId: string, label: string): void {
  void patchColumn(columnId, { label });
}

function onDeleteColumn(columnId: string): void {
  // Use a native confirm dialog: deleting a column reassigns its
  // items, which is reversible but worth a beat. The other column
  // operations (rename, mark-done) are inexpensive enough not to need
  // confirmation.
  const col = columns.value.find((column) => column.id === columnId);
  if (!col) return;
  const confirmed = window.confirm(`Delete column "${col.label}"? Items in this column will be moved to another column.`);
  if (!confirmed) return;
  void deleteColumn(columnId);
}

function onMarkDone(columnId: string): void {
  void patchColumn(columnId, { isDone: true });
}

function onReorderColumns(ids: string[]): void {
  void reorderColumns(ids);
}
</script>
