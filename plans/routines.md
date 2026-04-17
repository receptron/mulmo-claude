# Scheduler — Persistence, Catch-Up, Execution Logs

> Rewritten 2026-04-17. The original "Routines" plan covered user-defined LLM-driven recurring jobs. This revision widens the scope to **all scheduled work** — system tasks (journal, sources), skill-originated schedules, and user tasks — in a single unified scheduler with persistence, catch-up after downtime, and user-visible execution logs.

---

## 1) Motivation

Reading across #140, #141, #144, #166, and the original routines plan, the underlying intent:

> MulmoClaude should run things on its own, even when I'm not looking. When I come back — whether 5 minutes or 3 days later — I should see what it did, what it missed, and be able to fix it.

### Use cases

| UC | Origin | Schedule | If server was down |
|---|---|---|---|
| Daily news summary | Skill `daily-news` | daily 08:00 | Run once on catch-up (3-day-old summary still useful) |
| Standup reminder | User | daily 09:00 | Skip (yesterday's 9am is noise) |
| Source fetch (RSS) | System `sources` | daily 08:00 | Run once (fetch window auto-adjusts) |
| Journal daily pass | System `journal` | interval 1h | Run once (ingests everything since last run) |
| Hourly metrics ping | Skill | interval 1h | Run all missed (each data point matters) |
| One-shot reminder | User | once 2026-04-20 14:00 | Run late (reminder still useful) |
| Weekly report | Skill | weekly Mon 09:00 | Run once (late report > no report) |
| Chat-index backfill | System | interval 1h | Run once (idempotent) |

---

## 2) Design Goals

1. **One scheduler for everything** — system / skill / user tasks in a single registry with unified state + logs.
2. **Persistent across restarts** — task definitions (user), execution state (all), and logs survive server restart and crash.
3. **Catch-up after gaps** — server down 3 days? Each task's missed-run policy decides what to do.
4. **Server lifecycle aware** — handles startup, graceful shutdown, and crash recovery.
5. **User-visible** — execution log with what ran, when, result, and a link to the chat session.
6. **Timezone-friendly** — schedules stored in UTC; UI converts to/from the user's local time.
7. **No cron expressions** — typed schedule variants instead.

### Non-Goals

- DAG/workflow orchestration (sequential multi-step is just a skill prompt)
- Output routing to external channels (that's #142)
- Real-time sub-second precision (tick granularity is 60 s)

---

## 3) Core Concepts

### 3.1 Schedule

```ts
type TaskSchedule =
  | { type: "interval"; intervalSec: number }               // e.g. 3600 = every 1 hour
  | { type: "daily"; time: string }                         // "HH:MM" UTC
  | { type: "weekly"; daysOfWeek: number[]; time: string }  // 0=Sun..6=Sat, "HH:MM" UTC
  | { type: "once"; at: string };                           // ISO 8601 UTC (absolute)
```

`weekly` and `once` are first-class — no hack of "register daily, check day-of-week in the callback". The scheduler handles them directly.

**`interval` uses seconds, not milliseconds** — the tick granularity is 60 s, so sub-second precision is meaningless. `3600` is more readable than `3600000`.

**`once` is always stored as an absolute UTC timestamp.** But users can specify it two ways:

| Input form | Example | Resolved to |
|---|---|---|
| Absolute datetime | `2026-04-20T14:00:00Z` | stored as-is |
| Relative delay | `5h` / `30m` / `3600s` | resolved at creation time: `now + delay` → absolute UTC |

The API / SKILL.md parser / MCP tool all accept both forms; the conversion to absolute happens before storage. Once stored, the scheduler only sees the absolute `at` field — no ambiguity.

Examples of `once` usage:
- **User via chat**: "Remind me in 5 hours" → MCP tool sends `{ type: "once", delay: "5h" }` → API resolves to `at: "2026-04-17T17:30:00Z"` and stores
- **User via UI**: picks "2026-04-20 14:00" in a datetime picker → API converts local → UTC → stores
- **Skill frontmatter**: `schedule: once 2026-04-20T14:00:00Z` (always absolute in code-authored files)

### 3.2 Missed-Run Policy

```ts
type MissedRunPolicy =
  | "skip"      // time-sensitive: window passed → discard silently
  | "run-once"  // catch up with a single run, regardless of N missed
  | "run-all";  // catch up with min(N, MAX_CATCHUP) runs
```

Each task declares its policy. Applied on **startup** and whenever a **gap** is detected during normal ticking (laptop sleep → wake).

### 3.3 Task Origin

```ts
type TaskOrigin =
  | { kind: "system"; module: string }    // journal, sources, chat-index
  | { kind: "skill"; skillPath: string }  // SKILL.md with schedule: frontmatter
  | { kind: "user" };                     // created via UI / chat / API
```

| Origin | Definition lives in | Execution state persisted | Editable by user |
|---|---|---|---|
| System | Code (programmatic registration at boot) | Yes (state.json) | Enable/disable only |
| Skill | SKILL.md file with `schedule:` frontmatter | Yes (state.json) | Edit the SKILL.md file |
| User | config/scheduler/tasks.json | Yes (state.json) | Full CRUD via API/UI |

### 3.4 Execution Context — `scheduledFor`

Every task run receives a **`scheduledFor`** timestamp: the UTC instant the run was originally supposed to fire. This is critical for `run-all` catch-up, where 3 missed daily runs produce 3 separate executions each targeting a different date.

```ts
interface TaskRunContext {
  /** The window this run belongs to. For a daily 08:00 task that was
   *  missed on Oct 10–12, the three catch-up runs get:
   *    scheduledFor: "2026-10-10T08:00:00Z"
   *    scheduledFor: "2026-10-11T08:00:00Z"
   *    scheduledFor: "2026-10-12T08:00:00Z"
   *  For a normal on-time run, this equals the current tick's time. */
  scheduledFor: string;    // ISO 8601 UTC

  /** Why this run is happening. */
  trigger: "scheduled" | "catch-up" | "manual" | "startup" | "shutdown";
}
```

**How executors use `scheduledFor`**:

| Executor | Usage |
|---|---|
| System (journal) | `maybeRunJournal()` already uses its own `lastDailyRunAt` for range — `scheduledFor` is informational for the log |
| System (sources) | `runSourcesPipeline({ scheduleType: "daily" })` — `scheduledFor` is informational; the pipeline's own state handles range |
| Skill / User (LLM) | **Injected into the prompt** (see §13). The skill body can reference it as `{{scheduledFor}}` or the scheduler prepends a system line. Example: a skill that writes a "work log for Oct 10" needs to know it's running for Oct 10, not Oct 13. |

**Why this matters**: without `scheduledFor`, a `run-all` catch-up of "make a daily work log" would produce 3 identical logs all dated today. With it, each run knows which day it's responsible for and can title/scope its output correctly.

### 3.5 Executor

What happens when a task fires:

| Origin | Executor |
|---|---|
| System (journal) | `maybeRunJournal()` — existing function |
| System (sources) | `runSourcesPipeline()` — existing function |
| System (chat-index) | `maybeIndexSession()` — existing function |
| Skill / User | `startChat({ message, roleId, chatSessionId })` — full agent run, sidebar-visible session |

All executors receive `TaskRunContext` so they can log and act on `scheduledFor`.

---

## 4) Data Model

### 4.1 Task Definition (user-created, persisted)

```ts
interface PersistedTask {
  id: string;                    // UUID
  name: string;
  description: string;
  schedule: TaskSchedule;
  missedRunPolicy: MissedRunPolicy;
  enabled: boolean;
  origin: TaskOrigin;
  roleId?: string;               // for skill/user tasks
  prompt?: string;               // for skill/user tasks
  createdAt: string;             // ISO UTC
  updatedAt: string;
}
```

### 4.2 Execution State (all origins, persisted)

```ts
interface TaskExecutionState {
  taskId: string;
  lastRunAt: string | null;        // ISO UTC — null = never run
  lastRunResult: "success" | "error" | "skipped" | null;
  lastRunDurationMs: number | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  totalRuns: number;
  nextScheduledAt: string | null;  // pre-computed for UI display
}
```

### 4.3 Execution Log Entry (append-only)

```ts
interface TaskLogEntry {
  taskId: string;
  taskName: string;
  scheduledFor: string;            // the window this run targets (ISO UTC)
  startedAt: string;               // when the run actually began
  completedAt: string;
  result: "success" | "error" | "skipped";
  durationMs: number;
  trigger: "scheduled" | "catch-up" | "manual" | "startup" | "shutdown";
  errorMessage?: string;
  chatSessionId?: string;          // if the task spawned an agent run
}
```

`scheduledFor` ≠ `startedAt`. For an on-time run they're close; for a catch-up run, `scheduledFor` may be days before `startedAt`. This lets the user see "this run was for Oct 11" even though it executed on Oct 13.

---

## 5) Persistence Layout

```text
~/mulmoclaude/
  config/
    scheduler/
      tasks.json             ← user-created tasks (PersistedTask[])
      state.json             ← execution state for ALL tasks (keyed by taskId)
  data/
    scheduler/
      logs/
        2026-04-17.jsonl     ← daily execution log (rotate, keep 30 days)
```

System tasks aren't in tasks.json (code IS the definition), but their execution state IS in state.json so catch-up works across restarts.

---

## 6) Server Lifecycle

### 6.1 Normal startup

```text
1. Load config/scheduler/state.json (execution state for all tasks)
2. Register system tasks (journal, sources, chat-index)
3. Scan skills with schedule: frontmatter → register skill tasks
4. Load config/scheduler/tasks.json → register user tasks
5. For each enabled task:
     run catch-up algorithm (§7)
6. Compute nextScheduledAt for each task → write state.json
7. Start tick loop (every 60s)
8. Log: "scheduler started, N tasks registered, M catch-up runs enqueued"
```

### 6.2 Graceful shutdown (`SIGTERM` / `SIGINT`)

```text
1. Stop tick loop (no new tasks fire)
2. Wait for in-flight task runs to complete (timeout: 30s)
3. Write state.json with current timestamps
4. Log entry: trigger="shutdown" for each completed task
5. If timeout hit: log warning for still-running tasks
```

The saved state.json ensures the next startup knows exactly where each task left off. No work is lost.

### 6.3 Crash recovery (process killed / OOM / power loss)

State.json is written **atomically** (tmp + rename) after every task completion. On crash:
- The file reflects state as of the last completed task, not mid-write.
- On next startup, the catch-up algorithm (§7) detects the gap between lastRunAt and now, and applies each task's missed-run policy.
- **In-flight task at crash time**: its state.lastRunAt was NOT advanced (write happens after completion), so the catch-up algorithm treats it as a missed window → re-runs it.

### 6.4 Laptop sleep / suspend

The tick loop compares `now - lastTickAt`. If the gap exceeds 2× tickMs (e.g., laptop lid closed 30 min, tick is 60s), it runs the startup catch-up algorithm for all tasks. This handles resume-from-sleep without a restart.

---

## 7) Catch-Up Algorithm

```text
for each enabled task:
  windows[] = listMissedWindows(state.lastRunAt, now, task.schedule)
  //  e.g. daily 08:00, lastRunAt = Oct 10 08:30, now = Oct 13 10:00
  //  → windows = ["2026-10-11T08:00Z", "2026-10-12T08:00Z", "2026-10-13T08:00Z"]
  if windows.length == 0: continue

  switch task.missedRunPolicy:
    "skip":
      advance state.lastRunAt to now
      log(taskId, result="skipped", trigger="catch-up",
          note="{windows.length} windows skipped: {windows[0]}..{windows[-1]}")

    "run-once":
      // Use the LATEST missed window as scheduledFor — the most
      // relevant one to catch up on. Example: 3 missed daily news
      // summaries → run once for Oct 12 (yesterday), not Oct 10.
      enqueue 1 run:
        trigger = "catch-up"
        scheduledFor = windows[windows.length - 1]

    "run-all":
      // Enqueue one run per missed window, oldest first, each with
      // its own scheduledFor so the prompt can reference the correct
      // date. Example: "work log for 10/10", "work log for 10/11", "work log for 10/12".
      n = min(windows.length, MAX_CATCHUP)
      for i in 0..n:
        enqueue run:
          trigger = "catch-up"
          scheduledFor = windows[i]
      // Runs execute sequentially (no concurrent agent runs on same role).
```

**`MAX_CATCHUP`**: 24 (= 1 day of hourly tasks). Configurable per task in Phase 2 if needed.

### Concrete example: "daily work log" with `run-all`

Server down Oct 10 evening → startup Oct 13 morning.

```text
Task: "Daily work log", daily 18:00, run-all
Missed windows:
  2026-10-11T18:00Z  ← Oct 11 evening
  2026-10-12T18:00Z  ← Oct 12 evening

Catch-up enqueues 2 runs, oldest first:
  Run 1: scheduledFor = "2026-10-11T18:00:00Z"
    → prompt includes: "Create a work log for 2026-10-11."
    → agent creates: "Work log for Oct 11"
  Run 2: scheduledFor = "2026-10-12T18:00:00Z"
    → prompt includes: "Create a work log for 2026-10-12."
    → agent creates: "Work log for Oct 12"
```

Each run is a separate chat session visible in the sidebar.

### `countMissedWindows` logic

| Schedule | Missed count |
|---|---|
| `interval` | `floor((now - lastRunAt) / intervalSec) - 1` |
| `daily` | number of times HH:MM UTC has passed between lastRunAt and now |
| `weekly` | number of matching dayOfWeek + HH:MM between lastRunAt and now |
| `once` | 1 if `at < now && (lastRunAt == null \|\| lastRunAt < at)`, else 0 |

---

## 8) Timezone Handling

**Storage**: all schedule times are UTC. `tasks.json` stores `"time": "23:00"` (UTC).

**UI input**: the browser sends its `Intl.DateTimeFormat().resolvedOptions().timeZone` (e.g. `"Asia/Tokyo"`). The API converts the user's local time to UTC before storing. Example: user in Tokyo enters "08:00" → stored as `"23:00"` UTC (08:00 JST = 23:00 UTC previous day).

**UI display**: the frontend converts UTC back to the browser's timezone for display. "Daily at 23:00 UTC" renders as "Daily at 08:00" in a Tokyo browser.

**Travel**: if the user sets 4am in Japan and travels to New York, the task still fires at the same UTC moment. It doesn't follow the user. This is intentional — the original time was meaningful in context (e.g. "before the Tokyo office wakes up"), and shifting it would break the intent. The user can edit if they want a different local time.

**Original timezone metadata**: optionally store `{ time: "23:00", displayTz: "Asia/Tokyo", displayTime: "08:00" }` so the UI can show "08:00 JST" even when the user is browsing from a US timezone. Not required for Phase 1.

---

## 9) System Task Registration

Currently, journal / sources / chat-index use ad-hoc scheduling (agent-route finally hook, not the scheduler). This plan migrates them:

| Module | Current trigger | New trigger |
|---|---|---|
| Journal daily pass | Agent route finally hook | Scheduler: `system:journal`, interval 1h, run-once |
| Journal optimization | Agent route finally hook | Scheduler: `system:journal-opt`, interval 7d, run-once |
| Sources daily | Not wired yet | Scheduler: `system:sources-daily`, daily configurable, run-once |
| Chat-index backfill | Agent route finally hook | Scheduler: `system:chat-index`, interval 1h, run-once |

**Journal's finally-hook stays as a supplementary trigger**: the scheduler fires journal every 1h, but the agent-route finally hook ALSO calls `maybeRunJournal()` so journals run immediately after user activity. The module's internal `isDailyDue()` + lock prevents double runs. This gives the best of both: scheduler ensures catch-up after gaps, finally-hook ensures responsiveness during active use.

---

## 10) Skill Schedule Frontmatter

```yaml
---
description: Daily news summary from RSS sources
schedule: daily 08:00
missedRunPolicy: run-once
roleId: office
---

Fetch the latest items from all configured RSS sources and write
a summary for {{scheduledDate}}.
```

**Template variables** available in the skill body:

| Variable | Replaced with | Example |
|---|---|---|
| `{{scheduledFor}}` | Full ISO timestamp of the target window | `2026-10-11T08:00:00Z` |
| `{{scheduledDate}}` | Date portion only (YYYY-MM-DD) | `2026-10-11` |

Skills that use `run-all` SHOULD use `{{scheduledDate}}` in their prompt so each catch-up run targets the correct date. Example:

```yaml
---
description: Daily work log
schedule: daily 18:00
missedRunPolicy: run-all
roleId: office
---

Create a work log for {{scheduledDate}}.
Summarize the day's activities from chat history and wiki updates.
```

If the server was down Oct 10–12, the catch-up produces:
- Run 1: prompt = "Create a work log for 2026-10-11. …"
- Run 2: prompt = "Create a work log for 2026-10-12. …"

Skills that use `run-once` or `skip` may omit `{{scheduledDate}}` — the preamble (§13) still injects the window as system context for the LLM.

**Parsing format**: `schedule:` is a single string, parsed into `TaskSchedule`:

| Frontmatter string | Parsed |
|---|---|
| `daily 08:00` | `{ type: "daily", time: "08:00" }` |
| `interval 6h` | `{ type: "interval", intervalSec: 21600 }` |
| `interval 3600s` | `{ type: "interval", intervalSec: 3600 }` |
| `weekly Mon,Wed 18:00` | `{ type: "weekly", daysOfWeek: [1,3], time: "18:00" }` |
| `once 2026-04-20T14:00:00Z` | `{ type: "once", at: "2026-04-20T14:00:00Z" }` |
| `once 5h` | `{ type: "once", at: "<now + 5h, resolved at parse time>" }` |

**Note**: skill schedule times are UTC (the skill author knows this). No timezone conversion — skills are developer-written, not end-user-written.

`missedRunPolicy` defaults to `run-once` if omitted.
`roleId` defaults to `general` if omitted.

---

## 11) API Surface

```text
GET    /api/scheduler/tasks              ← all tasks (system + skill + user) with state
GET    /api/scheduler/tasks/:id          ← single task + state + recent log entries
POST   /api/scheduler/tasks              ← create user task
PUT    /api/scheduler/tasks/:id          ← update (enable/disable, schedule, prompt, etc.)
DELETE /api/scheduler/tasks/:id          ← delete (user tasks only)
POST   /api/scheduler/tasks/:id/run      ← manual trigger (any origin)

GET    /api/scheduler/logs               ← execution log
         ?since=ISO                        filter: after this time
         ?taskId=ID                        filter: for this task
         ?limit=N                          pagination (default 50)
```

System and skill tasks return `origin.kind` so the UI can grey out Edit/Delete.

### MCP Tool: `manageScheduler`

Same tool shape as the original `manageRoutines`, renamed. `action: "create" | "list" | "delete" | "run"`. Added to roles that need scheduling (general, office).

---

## 12) Execution Visibility (UI)

### Task list view

| Column | Source |
|---|---|
| Name | task.name |
| Origin | 🔧 system / 📜 skill / 👤 user |
| Schedule | "Daily at 08:00" (displayed in user's local tz) |
| Missed policy | `skip` / `run-once` / `run-all` badge |
| Last run | time + ✓/✗/⏭ icon |
| Next run | pre-computed from state.nextScheduledAt |
| Enabled | toggle |
| Actions | ▶ Run now, ✏️ Edit (user), 🗑 Delete (user) |

### Execution log (expandable per task)

| Time | Trigger | Duration | Result | Session |
|---|---|---|---|---|
| 04-17 08:00 | scheduled | 45s | ✓ | [→ open] |
| 04-17 startup | catch-up | 52s | ✓ | [→ open] |
| 04-15 08:00 | scheduled | — | ⏭ skipped | — |

"Session" link opens the chat session the task spawned.

### Notification integration (Phase 4)

- #144 (in-app): toast "✓ Daily news summary completed"
- #142 (external): push to Telegram/Slack on completion or failure

---

## 13) LLM Execution (when a skill/user task fires)

```ts
async function executeScheduledTask(
  task: PersistedTask,
  ctx: TaskRunContext,
  deps: { startChat, log, appendLog, updateState },
): Promise<void> {
  const chatSessionId = `sched-${task.id}-${Date.now()}`;
  const startedAt = new Date().toISOString();

  // ── Inject scheduledFor into the prompt ──────────────────────
  // The agent MUST know which window this run targets. Without it,
  // a catch-up run for "work log for 10/11" would produce a log dated
  // today instead of Oct 11.
  //
  // Two injection methods (both applied):
  //
  // 1. System preamble: always prepended, invisible to the user but
  //    available to the LLM as grounding context.
  //
  // 2. Template variable: if the prompt contains {{scheduledFor}}
  //    or {{scheduledDate}}, those are replaced with the ISO
  //    timestamp or YYYY-MM-DD date respectively.

  const scheduledDate = ctx.scheduledFor.slice(0, 10); // "2026-10-11"
  const preamble =
    `[Scheduler context] This task is running for the window: ${ctx.scheduledFor} (${scheduledDate}).` +
    (ctx.trigger === "catch-up"
      ? ` This is a catch-up run — the originally scheduled time has passed.`
      : "") +
    `\n\n`;
  const rawPrompt = task.prompt ?? "";
  const expandedPrompt = rawPrompt
    .replace(/\{\{scheduledFor\}\}/g, ctx.scheduledFor)
    .replace(/\{\{scheduledDate\}\}/g, scheduledDate);
  const message = preamble + expandedPrompt;

  const result = await deps.startChat({
    message,
    roleId: task.roleId ?? "general",
    chatSessionId,
  });

  if (result.kind === "error") {
    deps.appendLog({
      taskId: task.id, taskName: task.name, startedAt,
      completedAt: new Date().toISOString(),
      result: "error", trigger: ctx.trigger,
      scheduledFor: ctx.scheduledFor,
      errorMessage: result.error,
    });
    deps.updateState(task.id, { lastRunResult: "error", ... });
    return;
  }

  // Wait for session_finished via onSessionEvent
  await waitForSessionFinished(chatSessionId, deps);

  deps.appendLog({
    taskId: task.id, taskName: task.name,
    startedAt, completedAt: new Date().toISOString(),
    result: "success", trigger: ctx.trigger,
    scheduledFor: ctx.scheduledFor,
    chatSessionId,
  });
  deps.updateState(task.id, {
    lastRunAt: ctx.scheduledFor, // advance to the window, not wall-clock
    lastRunResult: "success", ...
  });
}
```

The session appears in the sidebar like any other conversation. User can open it, see what the agent did, and continue the conversation if needed.

---

## 14) Implementation Phases

### Phase 1: Persistence + catch-up engine

- Extend `server/events/task-manager/` with:
  - `types.ts` — `TaskSchedule` (weekly/once), `MissedRunPolicy`, `PersistedTask`, `TaskExecutionState`, `TaskLogEntry`
  - `state.ts` — load/save state.json (atomic write)
  - `catchup.ts` — `countMissedWindows`, `applyCatchUp` (pure, testable)
  - `log.ts` — append log entry, query log (JSONL read/write)
  - `index.ts` — extended: weekly/once schedule matching, gap detection, shutdown hook
- Register journal + sources + chat-index as system tasks
- `WORKSPACE_PATHS` entries for `config/scheduler/` and `data/scheduler/logs/`
- API: `GET /api/scheduler/tasks`, `GET /api/scheduler/logs`
- Unit tests: catch-up algorithm, schedule matchers, gap detection, state persistence

### Phase 2: Skill scheduling

- Extend `server/workspace/skills/parser.ts` with `schedule:` / `missedRunPolicy:` / `roleId:`
- `loadSkillSchedules()` at boot → register
- Skill tasks fire `startChat()` → sidebar-visible sessions

### Phase 3: User tasks + UI

- `tasks.json` CRUD + MCP tool `manageScheduler`
- `SchedulerView.vue` — task list + execution log
- Canvas or sidebar integration

### Phase 4: Notification wiring

- Task completion → #144 in-app notification
- Task failure → #142 external notification

---

## 15) File / Module Plan

```text
server/
  events/
    task-manager/
      index.ts              ← EXTENDED: persistence, catch-up, weekly/once, lifecycle hooks
      types.ts              ← NEW: full type definitions
      catchup.ts            ← NEW: catch-up algorithm (pure, testable)
      log.ts                ← NEW: JSONL execution log read/write
      state.ts              ← NEW: state.json load/save (atomic)
  api/
    routes/
      scheduler.ts          ← EXTENDED: tasks CRUD + logs endpoint
  workspace/
    skills/
      parser.ts             ← EXTENDED: schedule frontmatter (Phase 2)
    journal/
      index.ts              ← MODIFIED: register as system task (keep finally-hook too)

src/
  plugins/
    manageScheduler/        ← MCP tool (Phase 3)
  components/
    SchedulerView.vue       ← Task list + log viewer (Phase 3)

~/mulmoclaude/
  config/scheduler/
    tasks.json
    state.json
  data/scheduler/
    logs/YYYY-MM-DD.jsonl
```

---

## 16) Related Issues

| Issue | Relation |
|---|---|
| #166 (source registry) | Sources register as a system task |
| #144 (in-app notifications) | Task completion → notification pipeline (Phase 4) |
| #142 (external notifications) | Same pipeline, external delivery |
| #253 (top page) | Scheduler view could be a panel |
| ~~#140~~ (daily batch) | Closed → absorbed into #166 |
| ~~#141~~ (workflow builder) | Closed → absorbed by skills |

---

## 17) Decisions Log

| Question | Decision | Rationale |
|---|---|---|
| Timezone storage | UTC only; UI converts via browser tz | Simpler; travel doesn't shift the task from its original intent |
| Journal migration | Scheduler + keep finally-hook | Scheduler for catch-up; finally-hook for responsiveness |
| Cron expressions | No | Typed variants are safer and self-documenting |
| weekly/once in task-manager | First-class | Avoids fragile "daily + day-check" hack |
| Crash recovery | Atomic state.json + catch-up on startup | No data loss; in-flight task re-runs |
| MAX_CATCHUP | 24 | 1 day of hourly = safe default; per-task override in Phase 2 |
| Execution log format | Daily JSONL rotation, 30-day retention | Grep-friendly, bounded growth |
