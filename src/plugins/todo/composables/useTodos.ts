// Shared state + REST helpers for the file-explorer Todo views
// (TodoExplorer.vue, TodoKanbanView.vue, TodoTableView.vue,
// TodoListView.vue). Centralising the data layer here keeps each view
// focused on rendering, and means there's only one place to add
// optimistic-update / error-recovery logic.
//
// All mutating helpers POST/PATCH against the Web-UI REST routes added
// in Phase 1 (server/routes/todos.ts) — the MCP `manageTodoList`
// action route is intentionally NOT used by the explorer.

import { ref, type Ref } from "vue";
import { API_ROUTES } from "../../../config/apiRoutes";
import { useFreshPluginData } from "../../../composables/useFreshPluginData";
import { errorMessage } from "../../../utils/errors";
import { apiCall } from "../../../utils/api";
import type { StatusColumn, TodoItem } from "../index";

interface TodosResponse {
  data?: { items?: TodoItem[]; columns?: StatusColumn[] };
}

function isTodoItemArray(value: unknown): value is TodoItem[] {
  return Array.isArray(value);
}

function isStatusColumnArray(value: unknown): value is StatusColumn[] {
  return Array.isArray(value);
}

function extractItems(json: unknown): TodoItem[] | null {
  const items = (json as TodosResponse).data?.items;
  return isTodoItemArray(items) ? items : null;
}

function extractColumns(json: unknown): StatusColumn[] | null {
  const cols = (json as TodosResponse).data?.columns;
  return isStatusColumnArray(cols) ? cols : null;
}

// Apply parsed JSON payload (always { data: { items, columns } } for
// the new REST routes) into the local refs. Centralised so every
// helper uses the same parser and error guard. Returns false on a
// payload missing the items array.
function applyPayload(json: unknown, items: Ref<TodoItem[]>, columns: Ref<StatusColumn[]>): boolean {
  const nextItems = extractItems(json);
  const nextColumns = extractColumns(json);
  if (nextItems) items.value = nextItems;
  if (nextColumns) columns.value = nextColumns;
  return nextItems !== null;
}

export interface UseTodosHandle {
  items: Ref<TodoItem[]>;
  columns: Ref<StatusColumn[]>;
  error: Ref<string | null>;
  refresh: () => Promise<boolean>;
  // ── item ops ──
  createItem: (input: CreateItemInput) => Promise<boolean>;
  patchItem: (id: string, input: PatchItemInput) => Promise<boolean>;
  moveItem: (id: string, input: MoveItemInput) => Promise<boolean>;
  deleteItem: (id: string) => Promise<boolean>;
  // ── column ops ──
  addColumn: (input: AddColumnInput) => Promise<boolean>;
  patchColumn: (id: string, input: PatchColumnInput) => Promise<boolean>;
  deleteColumn: (id: string) => Promise<boolean>;
  reorderColumns: (ids: string[]) => Promise<boolean>;
}

export interface CreateItemInput {
  text: string;
  note?: string;
  status?: string;
  priority?: string;
  dueDate?: string;
  labels?: string[];
}

export interface PatchItemInput {
  text?: string;
  note?: string | null;
  status?: string;
  priority?: string | null;
  dueDate?: string | null;
  labels?: string[];
  completed?: boolean;
}

export interface MoveItemInput {
  status?: string;
  position?: number;
}

export interface AddColumnInput {
  label: string;
  isDone?: boolean;
}

export interface PatchColumnInput {
  label?: string;
  isDone?: boolean;
}

// Initial values come from the caller (e.g. the parent View receives
// items via its `selectedResult` prop). The composable then refreshes
// from the server on mount and updates the refs in place.
export function useTodos(initialItems: TodoItem[] = [], initialColumns: StatusColumn[] = []): UseTodosHandle {
  const items = ref<TodoItem[]>(initialItems);
  const columns = ref<StatusColumn[]>(initialColumns);
  const error = ref<string | null>(null);

  const { refresh: rawRefresh } = useFreshPluginData<{
    items: TodoItem[];
    columns: StatusColumn[];
  }>({
    endpoint: () => API_ROUTES.todos.list,
    extract: (json) => {
      const extractedItems = extractItems(json);
      const extractedColumns = extractColumns(json);
      if (!extractedItems) return null;
      return { items: extractedItems, columns: extractedColumns ?? [] };
    },
    apply: ({ items: nextItems, columns: nextColumns }) => {
      items.value = nextItems;
      if (nextColumns.length > 0) columns.value = nextColumns;
    },
  });

  // useFreshPluginData swallows fetch errors silently — its refresh
  // returns false on failure but never updates anything callers can
  // observe. Wrap it so the initial GET / manual reloads surface
  // through the same `error` ref the rest of the composable uses.
  async function refresh(): Promise<boolean> {
    error.value = null;
    const success = await rawRefresh();
    if (!success) error.value = "Failed to load todos";
    return success;
  }

  // Thin wrapper around apiCall that applies the response payload
  // into the local refs and surfaces errors through `error.value`.
  // Using apiCall (not raw fetch) ensures the #272 bearer token is
  // attached to every request.
  async function call(url: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<boolean> {
    error.value = null;
    try {
      const result = await apiCall<unknown>(url, { method, body });
      if (!result.ok) {
        error.value = result.error;
        return false;
      }
      const applied = applyPayload(result.data, items, columns);
      if (!applied) {
        error.value = `Request failed: unexpected payload shape`;
        return false;
      }
      return true;
    } catch (err) {
      error.value = errorMessage(err);
      return false;
    }
  }

  return {
    items,
    columns,
    error,
    refresh,
    createItem: (input) => call(API_ROUTES.todos.items, "POST", input),
    patchItem: (itemId, input) => call(API_ROUTES.todos.item.replace(":id", encodeURIComponent(itemId)), "PATCH", input),
    moveItem: (itemId, input) => call(API_ROUTES.todos.itemMove.replace(":id", encodeURIComponent(itemId)), "POST", input),
    deleteItem: (itemId) => call(API_ROUTES.todos.item.replace(":id", encodeURIComponent(itemId)), "DELETE"),
    addColumn: (input) => call(API_ROUTES.todos.columns, "POST", input),
    patchColumn: (colId, input) => call(API_ROUTES.todos.column.replace(":id", encodeURIComponent(colId)), "PATCH", input),
    deleteColumn: (colId) => call(API_ROUTES.todos.column.replace(":id", encodeURIComponent(colId)), "DELETE"),
    reorderColumns: (ids) => call(API_ROUTES.todos.columnsOrder, "PUT", { ids }),
  };
}
