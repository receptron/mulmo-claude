export interface TodoFixture {
  id: string;
  text: string;
  note?: string;
  labels?: string[];
  completed: boolean;
  createdAt: number;
  status: string;
  priority?: string;
  dueDate?: string;
  order: number;
}

export const TODO_ITEMS: TodoFixture[] = [
  {
    id: "todo_a",
    text: "Buy groceries",
    labels: ["personal"],
    completed: false,
    createdAt: 1775900000000,
    status: "todo",
    order: 1000,
    priority: "medium",
    dueDate: "2026-04-15",
  },
  {
    id: "todo_b",
    text: "Write report",
    labels: ["work"],
    completed: false,
    createdAt: 1775901000000,
    status: "in_progress",
    order: 1000,
    priority: "high",
  },
  {
    id: "todo_c",
    text: "Fix login bug",
    labels: ["work", "urgent"],
    completed: false,
    createdAt: 1775902000000,
    status: "backlog",
    order: 1000,
    priority: "urgent",
    dueDate: "2026-04-13",
  },
  {
    id: "todo_d",
    text: "Clean kitchen",
    completed: true,
    createdAt: 1775903000000,
    status: "done",
    order: 1000,
  },
  {
    id: "todo_e",
    text: "Read book",
    labels: ["personal"],
    completed: false,
    createdAt: 1775904000000,
    status: "todo",
    order: 2000,
  },
];

export const TODO_COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "Todo" },
  { id: "in_progress", label: "In Progress" },
  { id: "done", label: "Done", isDone: true },
];

export const TODOS_RESPONSE = {
  data: { items: TODO_ITEMS, columns: TODO_COLUMNS },
};
