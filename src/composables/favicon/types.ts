// Shared types for the favicon palette resolver. Keeping them in a
// dedicated file lets `conditions.ts` and `resolveColor.ts` import
// them without cycling, and the unit tests pin the exact shape the
// context must satisfy.

export const FAVICON_STATES = {
  idle: "idle",
  running: "running",
  done: "done",
  error: "error",
} as const;

export type FaviconState = (typeof FAVICON_STATES)[keyof typeof FAVICON_STATES];

// Every possible path through `resolveColor` — the same enum used for
// the returned `reason` field so callers (and the log breadcrumb) can
// name the branch without memorising hex codes.
export const FAVICON_REASONS = {
  error: "error",
  overloaded: "overloaded",
  manyUnread: "many-unread",
  runningLong: "running-long",
  birthday: "birthday",
  newYear: "new-year",
  christmas: "christmas",
  lateNight: "late-night",
  morning: "morning",
  weekend: "weekend",
  idle: "idle",
} as const;

export type FaviconReason = (typeof FAVICON_REASONS)[keyof typeof FAVICON_REASONS];

// The full runtime context fed to `resolveColor`. Everything is
// plumbed in so the function stays pure: no `new Date()` inside, no
// global fetches — test fixtures can pin any branch.
export interface FaviconContext {
  state: FaviconState;
  /** Unread across every session, not just the active one. */
  sessionsUnreadCount: number;
  /** Epoch ms when the current agent run started, or null if idle. */
  runningSinceMs: number | null;
  /** "now" — caller's clock. Tests pass a fixed Date. */
  now: Date;
  /**
   * "MM-DD" if the user has a birthday stored in memory.md, else
   * null. Null → the birthday rule is skipped.
   */
  userBirthdayMMDD: string | null;
  /**
   * Server's 1-minute load average divided by logical core count.
   * `null` when the server hasn't reported yet or the platform
   * doesn't support `loadavg` (Windows).
   */
  cpuLoadRatio: number | null;
}

export interface FaviconPick {
  color: string;
  reason: FaviconReason;
}
