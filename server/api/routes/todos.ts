import { Router, Request, Response } from "express";
import {
  loadTodos as loadTodosRaw,
  saveTodos as saveTodosRaw,
  loadColumns as loadColumnsRaw,
  saveColumns as saveColumnsRaw,
} from "../../utils/files/todos-io.js";
import { dispatchTodos, type TodosActionInput } from "./todosHandlers.js";
import {
  type StatusColumn,
  DEFAULT_COLUMNS,
  handleAddColumn,
  handleDeleteColumn,
  handlePatchColumn,
  handleReorderColumns,
  normalizeColumns,
} from "./todosColumnsHandlers.js";
import {
  handleCreate,
  handleDeleteItem,
  handleMove,
  handlePatch,
  migrateItems,
  type CreateInput,
  type MoveInput,
  type PatchInput,
} from "./todosItemsHandlers.js";
import {
  respondWithDispatchResult,
  type DispatchSuccessResponse,
  type DispatchErrorResponse,
} from "./dispatchResponse.js";

import { API_ROUTES } from "../../../src/config/apiRoutes.js";

const router = Router();

export type TodoPriority = "low" | "medium" | "high" | "urgent";

export interface TodoItem {
  id: string;
  text: string;
  note?: string;
  labels?: string[];
  completed: boolean;
  createdAt: number;
  // ── Added for the file-explorer kanban view ──
  // status: id of a column from columns.json. Optional on the wire so
  // legacy items load cleanly; migrateTodos() backfills it on read.
  status?: string;
  priority?: TodoPriority;
  dueDate?: string; // ISO YYYY-MM-DD
  order?: number; // sort key within the same status column
}

function loadColumns(): StatusColumn[] {
  return normalizeColumns(loadColumnsRaw<unknown>(DEFAULT_COLUMNS));
}

function saveColumns(columns: StatusColumn[]): void {
  saveColumnsRaw(columns);
}

function loadTodos(): TodoItem[] {
  const raw = loadTodosRaw<TodoItem[]>([]);
  const columns = loadColumns();
  return migrateItems(raw, columns);
}

function saveTodos(items: TodoItem[]): void {
  saveTodosRaw(items);
}

// ── GET /api/todos ───────────────────────────────────────────────
//
// Returns the migrated items + the current status columns. The
// columns field is new; existing chat-side consumers only read
// `data.items` so adding a sibling key is non-breaking.

interface TodosListResponse {
  data: { items: TodoItem[]; columns: StatusColumn[] };
}

router.get(
  API_ROUTES.todos.list,
  (_req: Request, res: Response<TodosListResponse>) => {
    res.json({ data: { items: loadTodos(), columns: loadColumns() } });
  },
);

// ── POST /api/todos (legacy MCP action route) ────────────────────
//
// Uses the shared dispatcher response plumbing introduced in #145.
// The legacy MCP `manageTodoList` tool is the only consumer of this
// route — the file-explorer TodoExplorer calls the new id-based REST
// routes below instead — so the response shape stays the simple
// `{ data: { items } }` form. Columns aren't included here on purpose:
// the chat-side View.vue only reads `data.items`, and the explorer
// loads columns via GET /api/todos.

interface TodoBody extends TodosActionInput {
  action: string;
}

// Actions whose handlers may mutate state. "show" / "list_labels"
// are read-only views; persisting their result would be a no-op.
const READ_ONLY_ACTIONS = new Set(["show", "list_labels"]);

router.post(
  API_ROUTES.todos.dispatch,
  (
    req: Request<object, unknown, TodoBody>,
    res: Response<DispatchSuccessResponse<TodoItem> | DispatchErrorResponse>,
  ) => {
    const { action, ...input } = req.body;
    const items = loadTodos();
    const result = dispatchTodos(action, items, input);
    respondWithDispatchResult(res, result, {
      shouldPersist: !READ_ONLY_ACTIONS.has(action),
      instructions: "Display the updated todo list to the user.",
      persist: saveTodos,
    });
  },
);

// ── New REST routes for the file-explorer todo view ──────────────
//
// These are id-based and used exclusively by the web UI. They live
// alongside the legacy MCP action route so the LLM-facing contract
// stays unchanged.

interface ItemResponse {
  data: { items: TodoItem[]; columns: StatusColumn[] };
  item?: TodoItem;
}

interface ItemIdParams {
  id: string;
}

interface ColumnIdParams {
  id: string;
}

// POST /api/todos/items — create a new todo
router.post(
  API_ROUTES.todos.items,
  (
    req: Request<object, unknown, CreateInput>,
    res: Response<ItemResponse | DispatchErrorResponse>,
  ) => {
    const items = loadTodos();
    const columns = loadColumns();
    const result = handleCreate(items, columns, req.body);
    if (result.kind === "error") {
      res.status(result.status).json({ error: result.error });
      return;
    }
    saveTodos(result.items);
    res.json({
      data: { items: result.items, columns },
      ...(result.item && { item: result.item }),
    });
  },
);

// PATCH /api/todos/items/:id — partial update
router.patch(
  API_ROUTES.todos.item,
  (
    req: Request<ItemIdParams, unknown, PatchInput>,
    res: Response<ItemResponse | DispatchErrorResponse>,
  ) => {
    const items = loadTodos();
    const columns = loadColumns();
    const result = handlePatch(items, columns, req.params.id, req.body);
    if (result.kind === "error") {
      res.status(result.status).json({ error: result.error });
      return;
    }
    saveTodos(result.items);
    res.json({
      data: { items: result.items, columns },
      ...(result.item && { item: result.item }),
    });
  },
);

// POST /api/todos/items/:id/move — drag & drop persistence
router.post(
  API_ROUTES.todos.itemMove,
  (
    req: Request<ItemIdParams, unknown, MoveInput>,
    res: Response<ItemResponse | DispatchErrorResponse>,
  ) => {
    const items = loadTodos();
    const columns = loadColumns();
    const result = handleMove(items, columns, req.params.id, req.body);
    if (result.kind === "error") {
      res.status(result.status).json({ error: result.error });
      return;
    }
    saveTodos(result.items);
    res.json({
      data: { items: result.items, columns },
      ...(result.item && { item: result.item }),
    });
  },
);

// DELETE /api/todos/items/:id
router.delete(
  API_ROUTES.todos.item,
  (
    req: Request<ItemIdParams>,
    res: Response<ItemResponse | DispatchErrorResponse>,
  ) => {
    const items = loadTodos();
    const columns = loadColumns();
    const result = handleDeleteItem(items, req.params.id);
    if (result.kind === "error") {
      res.status(result.status).json({ error: result.error });
      return;
    }
    saveTodos(result.items);
    res.json({ data: { items: result.items, columns } });
  },
);

// ── Columns ──────────────────────────────────────────────────────

interface ColumnsResponse {
  data: { items: TodoItem[]; columns: StatusColumn[] };
}

interface AddColumnBody {
  label?: string;
  isDone?: boolean;
}

interface PatchColumnBody {
  label?: string;
  isDone?: boolean;
}

interface ReorderColumnsBody {
  ids?: string[];
}

router.get(
  API_ROUTES.todos.columns,
  (_req: Request, res: Response<ColumnsResponse>) => {
    res.json({ data: { items: loadTodos(), columns: loadColumns() } });
  },
);

router.post(
  API_ROUTES.todos.columns,
  (
    req: Request<object, unknown, AddColumnBody>,
    res: Response<ColumnsResponse | DispatchErrorResponse>,
  ) => {
    const items = loadTodos();
    const result = handleAddColumn(loadColumns(), items, req.body);
    if (result.kind === "error") {
      res.status(result.status).json({ error: result.error });
      return;
    }
    saveColumns(result.columns);
    if (result.items) saveTodos(result.items);
    res.json({ data: { items: loadTodos(), columns: result.columns } });
  },
);

router.patch(
  API_ROUTES.todos.column,
  (
    req: Request<ColumnIdParams, unknown, PatchColumnBody>,
    res: Response<ColumnsResponse | DispatchErrorResponse>,
  ) => {
    const items = loadTodos();
    const result = handlePatchColumn(
      loadColumns(),
      req.params.id,
      req.body,
      items,
    );
    if (result.kind === "error") {
      res.status(result.status).json({ error: result.error });
      return;
    }
    saveColumns(result.columns);
    if (result.items) saveTodos(result.items);
    res.json({ data: { items: loadTodos(), columns: result.columns } });
  },
);

router.delete(
  API_ROUTES.todos.column,
  (
    req: Request<ColumnIdParams>,
    res: Response<ColumnsResponse | DispatchErrorResponse>,
  ) => {
    const items = loadTodos();
    const result = handleDeleteColumn(loadColumns(), req.params.id, items);
    if (result.kind === "error") {
      res.status(result.status).json({ error: result.error });
      return;
    }
    saveColumns(result.columns);
    if (result.items) saveTodos(result.items);
    res.json({ data: { items: loadTodos(), columns: result.columns } });
  },
);

router.put(
  API_ROUTES.todos.columnsOrder,
  (
    req: Request<object, unknown, ReorderColumnsBody>,
    res: Response<ColumnsResponse | DispatchErrorResponse>,
  ) => {
    const result = handleReorderColumns(loadColumns(), req.body.ids ?? []);
    if (result.kind === "error") {
      res.status(result.status).json({ error: result.error });
      return;
    }
    saveColumns(result.columns);
    res.json({ data: { items: loadTodos(), columns: result.columns } });
  },
);

export default router;
