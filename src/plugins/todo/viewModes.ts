// View mode constants for the Todo Explorer.

export const TODO_VIEW = {
  kanban: "kanban",
  table: "table",
  list: "list",
} as const;

export type TodoViewMode = (typeof TODO_VIEW)[keyof typeof TODO_VIEW];

export const TODO_VIEW_MODES: {
  key: TodoViewMode;
  label: string;
  icon: string;
}[] = [
  { key: TODO_VIEW.kanban, label: "Kanban", icon: "view_kanban" },
  { key: TODO_VIEW.table, label: "Table", icon: "table_rows" },
  { key: TODO_VIEW.list, label: "List", icon: "view_list" },
];
