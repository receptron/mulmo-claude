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
import type { StatusColumn, TodoItem } from "../index";

interface TodosResponse {
  data?: { items?: TodoItem[]; columns?: StatusColumn[] };
}

function isTodoItemArray(x: unknown): x is TodoItem[] {
  return Array.isArray(x);
}

function isStatusColumnArray(x: unknown): x is StatusColumn[] {
  return Array.isArray(x);
}

function extractItems(json: unknown): TodoItem[] | null {
  const items = (json as TodosResponse).data?.items;
  return isTodoItemArray(items) ? items : null;
}

function extractColumns(json: unknown): StatusColumn[] | null {
  const cols = (json as TodosResponse).data?.columns;
  return isStatusColumnArray(cols) ? cols : null;
}

// Apply server response (always { data: { items, columns } } for the
// new REST routes) into the local refs. Centralised so every helper
// uses the same parser and error guard. Returns false on a non-OK
// status, malformed JSON, or a payload missing the items array.
async function applyResponse(
  response: Awaited<ReturnType<typeof fetch>>,
  items: Ref<TodoItem[]>,
  columns: Ref<StatusColumn[]>,
): Promise<boolean> {
  if (!response.ok) return false;
  try {
    const json: unknown = await response.json();
    const nextItems = extractItems(json);
    const nextColumns = extractColumns(json);
    if (nextItems) items.value = nextItems;
    if (nextColumns) columns.value = nextColumns;
    return nextItems !== null;
  } catch {
    return false;
  }
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
export function useTodos(
  initialItems: TodoItem[] = [],
  initialColumns: StatusColumn[] = [],
): UseTodosHandle {
  const items = ref<TodoItem[]>(initialItems);
  const columns = ref<StatusColumn[]>(initialColumns);
  const error = ref<string | null>(null);

  const { refresh: rawRefresh } = useFreshPluginData<{
    items: TodoItem[];
    columns: StatusColumn[];
  }>({
    endpoint: () => API_ROUTES.todos.list,
    extract: (json) => {
      const i = extractItems(json);
      const c = extractColumns(json);
      if (!i) return null;
      return { items: i, columns: c ?? [] };
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
    const ok = await rawRefresh();
    if (!ok) error.value = "Failed to load todos";
    return ok;
  }

  // Use Parameters<typeof fetch> rather than the global RequestInit
  // type so this file doesn't depend on the DOM lib being in the
  // ESLint globals (which it isn't outside src/composables/).
  type FetchInit = Parameters<typeof fetch>[1];

  async function call(url: string, init: FetchInit): Promise<boolean> {
    error.value = null;
    try {
      const res = await fetch(url, init);
      const ok = await applyResponse(res, items, columns);
      if (!ok) {
        // Try to surface a server error message if the body looks
        // like one. Falls back to a generic message.
        let message = `Request failed (${res.status})`;
        try {
          const body: unknown = await res.clone().json();
          if (
            typeof body === "object" &&
            body !== null &&
            typeof (body as { error?: unknown }).error === "string"
          ) {
            message = (body as { error: string }).error;
          }
        } catch {
          // ignore — keep the generic message
        }
        error.value = message;
      }
      return ok;
    } catch (err) {
      error.value = errorMessage(err);
      return false;
    }
  }

  function jsonInit(method: string, body: unknown): FetchInit {
    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  return {
    items,
    columns,
    error,
    refresh,
    createItem: (input) =>
      call(API_ROUTES.todos.items, jsonInit("POST", input)),
    patchItem: (id, input) =>
      call(
        API_ROUTES.todos.item.replace(":id", encodeURIComponent(id)),
        jsonInit("PATCH", input),
      ),
    moveItem: (id, input) =>
      call(
        API_ROUTES.todos.itemMove.replace(":id", encodeURIComponent(id)),
        jsonInit("POST", input),
      ),
    deleteItem: (id) =>
      call(API_ROUTES.todos.item.replace(":id", encodeURIComponent(id)), {
        method: "DELETE",
      }),
    addColumn: (input) =>
      call(API_ROUTES.todos.columns, jsonInit("POST", input)),
    patchColumn: (id, input) =>
      call(
        API_ROUTES.todos.column.replace(":id", encodeURIComponent(id)),
        jsonInit("PATCH", input),
      ),
    deleteColumn: (id) =>
      call(API_ROUTES.todos.column.replace(":id", encodeURIComponent(id)), {
        method: "DELETE",
      }),
    reorderColumns: (ids) =>
      call(API_ROUTES.todos.columnsOrder, jsonInit("PUT", { ids })),
  };
}
