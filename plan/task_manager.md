# Task Manager — Design Document

## 1) Context and Problem

The Node server is growing a set of background services that need periodic execution (cleanup, sync, reminder checks, digest generation, etc.).

If each service manages its own timer lifecycle, we get:
- duplicated scheduling logic,
- inconsistent error handling,
- increased risk of timer leaks on restart/hot reload,
- no single place to observe what's running.

### Goal

Create a **simple task scheduling service** (Task Manager) built around a single `setInterval` timer that wakes up every tick (1 minute in production, 1 second in debug mode), checks which tasks are due, and fires them asynchronously. No cron library, no retry logic, no concurrency limits — just a tick loop and a task registry.

---

## 2) Design Goals and Non-Goals

### Goals
1. **Single timer** — one `setInterval` drives all task scheduling.
2. **Simple registration API** — `registerTask()` / `removeTask()`.
3. **Two schedule types** — time-of-day or fixed interval.
4. **Fire-and-forget execution** — tasks run asynchronously; errors are logged, never propagated.
5. **Safe startup/shutdown** — `start()` / `stop()` lifecycle.
6. **Testability** — injectable clock function.

### Non-Goals
1. Cron expressions or cron library dependency.
2. Retry or backoff logic.
3. Concurrency limits or overlap policies.
4. Task dependency or ordered execution.
5. Distributed coordination across server instances.

---

## 3) High-Level Architecture

```text
Feature Service A ----\
Feature Service B -----+--> TaskManager.registerTask(def)
Feature Service C ----/

TaskManager
  - Registry: Map<id, TaskEntry>
  - Timer: single setInterval (60s prod / 1s debug)
  - Tick handler: iterates registry, checks isDue(), fires run()
```

### How the Tick Works

Every tick (1 minute or 1 second):
1. Get current time via injected `now()`.
2. For each enabled task in the registry:
   - Check if the current time (rounded to the tick) aligns with the task's schedule.
   - If due, call `task.run()` asynchronously (no await — fire-and-forget).
3. That's it. No state tracked between ticks.

### Schedule Types

Both types are **wall-clock aligned to UTC**. No elapsed-time tracking needed.

**Interval**: Run at fixed wall-clock positions. `intervalMs` divides the day into equal slots starting from midnight UTC. E.g., `intervalMs: 4 * 60 * 60 * 1000` (4 hours) fires at 0:00, 4:00, 8:00, 12:00, 16:00, 20:00 UTC. A task is due when the current time (rounded to the tick) is a multiple of the interval.

**Daily**: Run once per day at a specific `HH:MM` (24h format, UTC). A task is due when the current hour and minute match.

---

## 4) Data Model

```ts
export type TaskSchedule =
  | { type: "interval"; intervalMs: number }
  | { type: "daily"; time: string };                     // time: "HH:MM" in UTC

export interface TaskDefinition {
  id: string;                    // globally unique; stable across restarts
  description?: string;
  schedule: TaskSchedule;
  enabled?: boolean;             // default: true
  run: (ctx: TaskRunContext) => Promise<void>;
}

export interface TaskRunContext {
  taskId: string;
  now: Date;                     // the tick time that triggered this run
}

// No internal state needed — isDue() is purely a function of the current time.

```

---

## 5) Public API (Server-Internal)

```ts
interface ITaskManager {
  registerTask(def: TaskDefinition): void;
  removeTask(taskId: string): void;

  start(): void;                 // start the tick timer
  stop(): void;                  // stop the tick timer

  listTasks(): Array<{ id: string; description?: string; schedule: TaskSchedule }>;
}
```

### Constructor

```ts
interface TaskManagerOptions {
  tickMs?: number;               // default: 60_000 (1 minute); set to 1_000 for debug
  now?: () => Date;              // injectable clock; default: () => new Date()
}

function createTaskManager(options?: TaskManagerOptions): ITaskManager;
```

### Registration

```ts
const taskManager = createTaskManager({ tickMs: 60_000 });

taskManager.registerTask({
  id: "cleanup.sessions",
  description: "Delete expired sessions",
  schedule: { type: "interval", intervalMs: 10 * 60 * 1000 }, // every 10 minutes
  run: async ({ taskId, now }) => {
    await sessionStore.deleteExpired();
  },
});

taskManager.registerTask({
  id: "digest.daily",
  description: "Generate and send daily digest",
  schedule: { type: "daily", time: "13:00" },
  run: async () => {
    await digestService.generateAndSend();
  },
});

taskManager.start();
```

### Removing Tasks

`removeTask(taskId)` removes the task from the registry. If the task's `run()` is currently executing, it continues to completion (fire-and-forget). Calling `removeTask` on a non-existent ID is a no-op.

---

## 6) Tick Logic (Pseudocode)

```ts
function onTick(now: Date) {
  for (const def of registry.values()) {
    if (def.enabled === false) continue;
    if (!isDue(now, def.schedule, tickMs)) continue;

    def.run({ taskId: def.id, now })
      .catch((err) => {
        console.error(`[task-manager] ${def.id} failed:`, err);
      });
  }
}

function isDue(now: Date, schedule: TaskSchedule, tickMs: number): boolean {
  if (schedule.type === "interval") {
    const msSinceMidnight =
      now.getUTCHours() * 3600000 +
      now.getUTCMinutes() * 60000 +
      now.getUTCSeconds() * 1000;
    const rounded = Math.floor(msSinceMidnight / tickMs) * tickMs;
    return rounded % schedule.intervalMs === 0;
  }

  if (schedule.type === "daily") {
    const [hh, mm] = schedule.time.split(":").map(Number);
    const targetMs = hh * 3600000 + mm * 60000;
    const msSinceMidnight =
      now.getUTCHours() * 3600000 +
      now.getUTCMinutes() * 60000 +
      now.getUTCSeconds() * 1000;
    const rounded = Math.floor(msSinceMidnight / tickMs) * tickMs;
    return rounded === targetMs;
  }

  return false;
}
```

---

## 7) Startup and Shutdown

### Startup
1. Construct `TaskManager` with options.
2. Register tasks.
3. Call `start()` — begins the tick timer.

### Shutdown
1. Call `stop()` — clears the `setInterval`.
2. Currently running tasks continue to completion (no abort).
3. No new tasks will be triggered.

---

## 8) Error Handling

- All `run()` errors are caught in `.catch()` and logged via `console.error`.
- A failing task never affects other tasks or the tick timer.
- No retry — if a task fails, it will be attempted again at its next scheduled time.

---

## 9) File/Module Plan

```text
server/
  task-manager/
    index.ts               // createTaskManager + types
```

That's it — the entire implementation fits in one file.

Bootstrap integration in `server/index.ts`:
```ts
const taskManager = createTaskManager({ tickMs });

// register tasks here...

taskManager.start();

// on shutdown:
taskManager.stop();
```

Debug mode (tick interval, test tasks) is described in `plan/debug_mode.md`.

---

## 10) Testing Strategy

### Unit Tests
1. `isDue()` logic for interval schedules (slot boundary, same slot, day rollover).
2. `isDue()` logic for daily schedules (correct time, already run today).
3. `removeTask` while running (should not crash).

### Integration Tests
1. Start/stop lifecycle with fake clock.
2. Multiple tasks with different schedules firing independently.
3. Error in one task does not block others.

### Smoke Test
See `plan/debug_mode.md` — the `--debug` flag registers a self-removing counter task for instant smoke testing.

---

## 11) Decision Summary

The Task Manager is built around a single `setInterval` tick loop. Every tick checks which tasks are due and fires them asynchronously. No cron library, no retry, no concurrency control, no state tracking — just a registry, a timer, and fire-and-forget execution. The entire implementation fits in one file.
