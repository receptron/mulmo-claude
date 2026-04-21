// View mode and tab constants for the Scheduler plugin.

export const SCHEDULER_VIEW = {
  list: "list",
  week: "week",
  month: "month",
} as const;

export type SchedulerViewMode = (typeof SCHEDULER_VIEW)[keyof typeof SCHEDULER_VIEW];

export const SCHEDULER_VIEW_MODES: {
  key: SchedulerViewMode;
  label: string;
  icon: string;
}[] = [
  { key: SCHEDULER_VIEW.month, label: "Month", icon: "calendar_month" },
  { key: SCHEDULER_VIEW.week, label: "Week", icon: "view_week" },
  { key: SCHEDULER_VIEW.list, label: "List", icon: "view_list" },
];

export const SCHEDULER_TAB = {
  calendar: "calendar",
  tasks: "tasks",
} as const;

export type SchedulerTab = (typeof SCHEDULER_TAB)[keyof typeof SCHEDULER_TAB];
