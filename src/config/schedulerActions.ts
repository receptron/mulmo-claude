// Scheduler MCP tool action constants.
// Used by both the tool definition (frontend) and the route handler (server).

export const SCHEDULER_ACTIONS = {
  // Calendar item actions (existing)
  show: "show",
  add: "add",
  delete: "delete",
  update: "update",
  // Scheduled task actions (Phase 3)
  createTask: "createTask",
  listTasks: "listTasks",
  deleteTask: "deleteTask",
  runTask: "runTask",
} as const;

export type SchedulerAction =
  (typeof SCHEDULER_ACTIONS)[keyof typeof SCHEDULER_ACTIONS];

/** Task-specific actions that route to user-task subsystem. */
export const TASK_ACTIONS: ReadonlySet<string> = new Set([
  SCHEDULER_ACTIONS.createTask,
  SCHEDULER_ACTIONS.listTasks,
  SCHEDULER_ACTIONS.deleteTask,
  SCHEDULER_ACTIONS.runTask,
]);
