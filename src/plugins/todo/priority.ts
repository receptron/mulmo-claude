// Pure helpers for the todo `priority` field. Used by the kanban
// cards, the table view, and any future plugin code that needs to
// render a priority badge — kept dependency-free so both the server
// and the browser can import it.

import type { TodoPriority } from "./index";

export const PRIORITY_ORDER: Record<TodoPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};

// Display label for each priority level. Capitalised so it reads well
// in chips / dropdowns without further formatting at the call site.
export const PRIORITY_LABELS: Record<TodoPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

// Tailwind classes for the priority chip backgrounds. Picked to be
// distinguishable at small sizes without competing too hard with the
// label colours from labels.ts.
export const PRIORITY_CLASSES: Record<TodoPriority, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-sky-100 text-sky-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

// Tailwind border-color classes for the kanban card left border.
// Slightly bolder than the chip palette so a card with no labels still
// shows priority at a glance.
export const PRIORITY_BORDER: Record<TodoPriority, string> = {
  low: "border-l-slate-300",
  medium: "border-l-sky-400",
  high: "border-l-orange-400",
  urgent: "border-l-red-500",
};

export const PRIORITIES: readonly TodoPriority[] = ["low", "medium", "high", "urgent"];

export function isPriority(v: unknown): v is TodoPriority {
  // Use hasOwnProperty rather than the `in` operator: `in` walks the
  // prototype chain, so `"toString" in PRIORITY_ORDER` would return
  // true and incorrectly narrow `"toString"` to TodoPriority. We use
  // the .call form (rather than Object.hasOwn) because the project's
  // client tsconfig targets ES2021, and Object.hasOwn is ES2022.
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PRIORITY_ORDER, v);
}

// ── due date helpers ─────────────────────────────────────────────

// Returns a Tailwind class string for a due-date badge based on how
// far the date is from today. The 4 buckets match what GitHub
// Projects shows in its kanban view.
export function dueDateClasses(dueDate: string | undefined): string {
  if (!dueDate) return "";
  const today = todayISO();
  if (dueDate < today) return "bg-red-100 text-red-700";
  if (dueDate === today) return "bg-orange-100 text-orange-700";
  // Within 3 days?
  const t = new Date(today);
  const d = new Date(dueDate);
  const diffDays = Math.round((d.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 3) return "bg-yellow-100 text-yellow-700";
  return "bg-gray-100 text-gray-600";
}

// Today's date as YYYY-MM-DD in the user's local timezone. Avoiding
// `toISOString` here on purpose: that returns UTC, which would flip
// the day boundary for users west of UTC and lead to "due today"
// flickering at midnight.
export function todayISO(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Pretty short label for the kanban card badges. "2026-04-12" →
// "Apr 12". Year is omitted unless it differs from the current one.
export function formatDueLabel(dueDate: string | undefined): string {
  if (!dueDate) return "";
  const d = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dueDate;
  const today = new Date();
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
