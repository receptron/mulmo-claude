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
5. **Operational visibility** — last run time, next run time, error state per task.
6. **Safe startup/shutdown** — `start()` / `stop()` lifecycle.
7. **Testability** — injectable clock function.

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
   - Compute whether it is due based on its schedule type.
   - If due, call `task.run()` asynchronously (no await — fire-and-forget).
   - Update `lastStartedAt`. On completion, update `lastFinishedAt` / `lastError`.
3. That's it.

### Schedule Types

**Interval** (`every`): Run every N milliseconds. A task is due when `now - lastStartedAt >= intervalMs`.

**Time-of-day** (`daily`): Run once per day at a specific `HH:MM` (24h format, in configured timezone). A task is due when the current time matches the target hour/minute and it hasn't already run today.

---

## 4) Data Model

```ts
export type TaskSchedule =
  | { type: "interval"; intervalMs: number }
  | { type: "daily"; time: string; timezone?: string }; // time: "HH:MM", timezone default: UTC

export interface TaskDefinition {
  id: string;                    // globally unique; stable across restarts
  description?: string;
  schedule: TaskSchedule;
  enabled?: boolean;             // default: true
  run: (ctx: TaskRunContext) => Promise<void>;
}

export interface TaskRuntimeState {
  id: string;
  description?: string;
  enabled: boolean;
  running: boolean;

  lastStartedAt?: Date;
  lastFinishedAt?: Date;
  lastError?: { message: string; at: Date };

  runCount: number;
  errorCount: number;
}

export interface TaskRunContext {
  taskId: string;
  now: Date;                     // the tick time that triggered this run
}
```

---

## 5) Public API (Server-Internal)

```ts
interface ITaskManager {
  registerTask(def: TaskDefinition): void;
  removeTask(taskId: string): void;

  start(): void;                 // start the tick timer
  stop(): void;                  // stop the tick timer

  runNow(taskId: string): void;  // fire a task immediately (async)

  getState(taskId: string): TaskRuntimeState | undefined;
  listStates(): TaskRuntimeState[];
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
  schedule: { type: "daily", time: "13:00", timezone: "UTC" },
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
  for (const task of registry.values()) {
    if (!task.enabled) continue;

    if (isDue(task, now)) {
      task.state.lastStartedAt = now;
      task.state.running = true;
      task.state.runCount++;

      task.def.run({ taskId: task.def.id, now })
        .catch((err) => {
          task.state.errorCount++;
          task.state.lastError = { message: String(err), at: new Date() };
          logger?.error({ taskId: task.def.id, error: err }, "task failed");
        })
        .finally(() => {
          task.state.running = false;
          task.state.lastFinishedAt = new Date();
        });
    }
  }
}

function isDue(task: TaskEntry, now: Date): boolean {
  const { schedule } = task.def;

  if (schedule.type === "interval") {
    if (!task.state.lastStartedAt) return true; // never run → run immediately
    return now.getTime() - task.state.lastStartedAt.getTime() >= schedule.intervalMs;
  }

  if (schedule.type === "daily") {
    const [hh, mm] = schedule.time.split(":").map(Number);
    const taskTime = toTimezone(now, schedule.timezone ?? "UTC");
    if (taskTime.hours === hh && taskTime.minutes === mm) {
      // Only fire if we haven't already run during this minute
      if (!task.state.lastStartedAt) return true;
      const lastRun = toTimezone(task.state.lastStartedAt, schedule.timezone ?? "UTC");
      return lastRun.date !== taskTime.date; // different calendar day
    }
    return false;
  }
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

- All `run()` errors are caught in the `.catch()` of the fire-and-forget promise.
- Errors are logged and stored in `lastError` on the task's runtime state.
- A failing task never affects other tasks or the tick timer.
- No retry — if a task fails, it will be attempted again at its next scheduled time.

---

## 9) Observability

Log events via `console.log` with `[task-manager]` prefix:
- `task.started` — task execution began
- `task.succeeded` — task execution completed
- `task.failed` — task execution threw

---

## 10) Debug Mode

### Activation

Pass `--debug-tasks` as a command line argument to the server:

```bash
tsx server/index.ts --debug-tasks
```

Or in package.json:
```json
"dev:server:debug": "tsx server/index.ts --debug-tasks"
```

### Behavior

When `--debug-tasks` is active:
1. Tick interval is **1 second** instead of 60 seconds.
2. A built-in **counter test task** is registered automatically:
   - ID: `debug.counter`
   - Schedule: `{ type: "interval", intervalMs: 1_000 }` (every 1 second)
   - Maintains an internal counter, increments on each run, logs `[task-manager] debug.counter: N` to the console.
   - After 10 runs, unregisters itself via `removeTask("debug.counter")`.

This provides an immediate smoke test of the full lifecycle: register → tick → execute → self-unregister.

---

## 11) File/Module Plan

```text
server/
  task-manager/
    index.ts               // createTaskManager, exported types
    types.ts               // TaskDefinition, TaskRuntimeState, TaskSchedule, etc.
```

That's it — the entire implementation fits in two files.

Bootstrap integration in `server/index.ts`:
```ts
const debugTasks = process.argv.includes("--debug-tasks");

const taskManager = createTaskManager({
  tickMs: debugTasks ? 1_000 : 60_000,
});

// clients register tasks here...

if (debugTasks) {
  registerDebugTasks(taskManager);
}

taskManager.start();

// on shutdown:
taskManager.stop();
```

---

## 12) Testing Strategy

### Unit Tests
1. `isDue()` logic for interval schedules (first run, elapsed, not yet).
2. `isDue()` logic for daily schedules (correct time, already run today, timezone).
3. Registration validation (duplicate IDs, invalid time format).
4. `removeTask` while running (should not crash).
5. `runNow` fires immediately.

### Integration Tests
1. Start/stop lifecycle with fake clock.
2. Multiple tasks with different schedules firing independently.
3. Error in one task does not block others.

### Smoke Test
Run `tsx server/index.ts --debug-tasks` and observe 10 counter log lines followed by self-unregistration. No other infrastructure needed.

---

## 13) Decision Summary

The Task Manager is built around a single `setInterval` tick loop. Every tick checks which tasks are due and fires them asynchronously. No cron library, no retry, no concurrency control, no overlap policies — just a registry, a timer, and fire-and-forget execution. The entire implementation fits in ~150 lines across two files.

A `--debug-tasks` CLI flag switches to 1-second ticks and registers a self-removing counter task for instant smoke testing.
