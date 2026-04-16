# Task Manager

A tiny in-process scheduler for background work that needs to run
periodically on the server: "refresh X every hour", "run Y at 03:00
UTC daily", "tick every 5 minutes". One `setInterval`, no cron
library, no persistence — designed for development-workstation
lifetimes, not 24/7 infrastructure.

Canonical module: [`server/events/task-manager/index.ts`](../server/events/task-manager/index.ts).
Design rationale: [`plans/done/task_manager.md`](../plans/done/task_manager.md).

---

## When to use it (and when not to)

Use it for:

- Idle-time work that doesn't need user input (journal rebuild,
  chat-index freshness check, dev-mode counters).
- Pipelines the human can re-trigger on demand but that benefit
  from running periodically — e.g. the sources-registry daily
  brief could be scheduled here, then `Rebuild now` is just a
  manual trigger of the same task body.
- One-shot debugging heartbeats (`debug.counter` in `--debug`
  mode emits a `debug.beat` every second for 10 ticks, then
  self-removes).

**Don't** use it for:

- Cron-precise timing (down-to-the-second SLA). The tick granularity
  is 60 s in production, 1 s in `--debug`, and the scheduler rounds
  the current time down to a tick boundary before checking.
- Persistence across server restarts. Task state lives only in
  memory; `registerTask` is called every time `startRuntimeServices`
  runs. Restart = clean slate.
- Fan-out / parallelism control. Tasks are fire-and-forget; if two
  firings of the same task overlap they overlap. Guard inside your
  `run()` if that matters (e.g. `maybeRunJournal` already has its
  own "is a pass in flight?" lock).
- Retries. A throw surfaces via `log.error("task-manager", ...)` and
  the task waits until its next scheduled tick. No backoff, no DLQ.

---

## Quick start

```ts
// server/my-feature.ts
import type { ITaskManager } from "./task-manager/index.js";
import { log } from "./logger/index.js";

export function registerMyFeatureTasks(taskManager: ITaskManager) {
  // Every 15 minutes.
  taskManager.registerTask({
    id: "my-feature.refresh",
    description: "Refresh the my-feature cache from upstream",
    schedule: { type: "interval", intervalMs: 15 * 60_000 },
    run: async ({ taskId, now }) => {
      log.info("my-feature", "refresh start", { taskId });
      await refreshCache();
      log.info("my-feature", "refresh done", { at: now.toISOString() });
    },
  });

  // Daily at 03:15 UTC.
  taskManager.registerTask({
    id: "my-feature.nightly-cleanup",
    description: "Drop old entries past the retention window",
    schedule: { type: "daily", time: "03:15" },
    run: async () => {
      await pruneOld();
    },
  });
}
```

Then wire it into [`server/index.ts`](../server/index.ts)'s
`startRuntimeServices` next to the existing `taskManager` setup:

```ts
function startRuntimeServices(httpServer) {
  // ...
  const taskManager = createTaskManager({
    tickMs: debugMode ? 1_000 : 60_000,
  });
  if (debugMode) registerDebugTasks(taskManager, pubsub);
  registerMyFeatureTasks(taskManager); // ← add this line
  taskManager.start();
}
```

---

## API reference

### `createTaskManager(options?) → ITaskManager`

```ts
interface TaskManagerOptions {
  tickMs?: number;       // default: 60_000 (1 min). Set to 1_000 in --debug.
  now?: () => Date;      // default: () => new Date(). Injectable for tests.
}
```

The task manager returned isn't auto-started — call `.start()` when
the server is ready to take traffic. This keeps startup ordering
explicit and lets tests call `onTick` directly without a real timer.

### `ITaskManager`

```ts
interface ITaskManager {
  registerTask(def: TaskDefinition): void;  // throws if id already registered
  removeTask(taskId: string): void;         // no-op when id isn't registered
  start(): void;                            // starts the setInterval
  stop(): void;                             // clears the setInterval
  listTasks(): Array<{ id; description?; schedule }>;
}
```

Tasks can `removeTask` themselves from inside `run()` — that's how
`debug.counter` self-removes after 10 fires (see
`server/index.ts#registerDebugTasks`).

### `TaskDefinition`

```ts
interface TaskDefinition {
  id: string;                           // unique; collisions throw at registration
  description?: string;                 // shown in listTasks() for observability
  schedule: TaskSchedule;               // see below
  enabled?: boolean;                    // default: true. Set to false to park a task.
  run: (ctx: TaskRunContext) => Promise<void>;
}

type TaskSchedule =
  | { type: "interval"; intervalMs: number }   // every N ms since midnight UTC
  | { type: "daily"; time: string };           // "HH:MM" UTC, 24-hour
```

### `TaskRunContext`

```ts
interface TaskRunContext {
  taskId: string;
  now: Date;                            // the Date that triggered this firing
}
```

Pass `now` into downstream "current time" reads so the whole task
body observes a consistent timestamp (useful when the run straddles
a clock-tick boundary).

---

## Schedule semantics

The scheduler calls `onTick` every `tickMs`. On each tick it walks
the registry and fires every enabled task whose schedule is "due".
Due-checking is pure — see `isDue()` in
[`server/events/task-manager/index.ts`](../server/events/task-manager/index.ts).

- **`interval`**: due when `floor(msSinceMidnightUtc / tickMs) * tickMs`
  is a whole-number multiple of `intervalMs`. Practical effect:
  pick intervals that are multiples of your `tickMs` (e.g. 60 s, 5
  min, 1 h in production). An `intervalMs` smaller than `tickMs`
  fires every tick — probably not what you want.
- **`daily`**: due when the rounded msSinceMidnightUtc equals the
  target `HH:MM` in ms. UTC, not local — pick the time
  accordingly. Fires at most once per day at that slot.

Midnight rollover: `msSinceMidnightUtc` resets to 0 at 00:00 UTC,
so `interval` tasks all align on midnight. There's no "first run
now" option — if you need immediate execution on boot, call the
task body directly in `startRuntimeServices` and then `registerTask`
it for subsequent ticks.

---

## Error handling

`run()` is awaited with a `.catch()`. Rejections are logged at
error level with prefix `task-manager` and the task id:

```
ERROR [task-manager] task failed id=my-feature.refresh error="Error: boom"
```

Nothing surfaces to the user; no retry. If the task body is
idempotent you're fine — the next tick will try again. If it isn't,
guard inside `run()` (try/catch around the risky step, persist
progress, etc.).

---

## Debug mode

`--debug` starts the server with `tickMs: 1_000` so tasks fire
every second. `registerDebugTasks` installs a self-removing
`debug.counter` task that publishes `debug.beat` to the pub-sub
bus for 10 ticks, then unregisters itself. Useful for eyeballing
the loop and for tests that need "is scheduling alive?" signal.
Relevant code: `server/index.ts#registerDebugTasks`.

---

## Testing

Inject `now` and drive ticks manually — no real timer involved:

```ts
import { createTaskManager } from "../../server/events/task-manager/index.js";

const state = { t: new Date("2026-04-15T00:00:00Z") };
const tm = createTaskManager({
  tickMs: 60_000,
  now: () => state.t,
});

let fired = 0;
tm.registerTask({
  id: "test.every-5min",
  schedule: { type: "interval", intervalMs: 5 * 60_000 },
  run: async () => { fired++; },
});
tm.start();

// Advance the clock; onTick() is driven by the real setInterval so
// in unit tests we usually skip .start() entirely and call the
// dispatch loop directly. See `test/server/test_taskManager.ts` for
// the preferred shape.
```

`start` / `stop` are idempotent — calling `start()` twice is a no-op,
same for `stop()` when not started. This means test teardown can
always `tm.stop()` without checking.

---

## Observability

- `log.info("task-manager", "registered", { id })` on registration.
- `log.info("task-manager", "removed", { id })` on removal.
- `log.info("task-manager", "started", { tickMs })` when the tick
  interval begins.
- `log.info("task-manager", "stopped")` when it ends.
- `log.error("task-manager", "task failed", { id, error })` on a
  task rejection.

To list what's currently registered, call `taskManager.listTasks()`
— it returns a plain array of `{ id, description, schedule }` rows.
Good for a `/api/debug/tasks` endpoint if you need one (there isn't
one by default).
