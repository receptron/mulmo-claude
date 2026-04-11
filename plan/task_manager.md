# Generic Cron Task Manager — Design Document

## 1) Context and Problem

The Node server is growing a set of background services that need periodic execution (cleanup, sync, reminder checks, digest generation, etc.).

If each service manages its own timer/cron lifecycle, we get:
- duplicated scheduling logic,
- inconsistent error handling/retry behavior,
- hard-to-observe runtime state,
- increased risk of timer leaks on restart/hot reload,
- no single place to enforce limits (max concurrency, overlap policy, shutdown semantics).

### Goal
Create a **generic task scheduling service** (Task Manager) that lets feature services register cron jobs declaratively while centralizing:
- scheduling,
- execution lifecycle,
- observability,
- resilience,
- graceful shutdown.

---

## 2) Design Goals and Non-Goals

## Goals
1. **Single scheduling abstraction** for all background cron tasks.
2. **Simple registration API** for services (`registerTask(...)`).
3. **Deterministic runtime behavior** (explicit overlap and retry policies).
4. **Operational visibility** (last run, next run, duration, errors, disabled state).
5. **Safe startup/shutdown** with lifecycle hooks integrated into server boot.
6. **Testability** through dependency-injected clock/scheduler adapter.

## Non-Goals (v1)
1. Distributed job coordination across multiple server instances.
2. Durable queued execution (e.g., RabbitMQ/SQS-backed workers).
3. Exactly-once semantics across crashes.
4. A user-facing UI for editing cron expressions.
5. Persisting schedule definitions inside the Task Manager itself.
6. Task dependency/ordering (e.g., "run B after A completes").

---

## 3) High-Level Architecture

```text
Feature Service A ----\
Feature Service B -----+--> TaskManager.registerTask(def)
Feature Service C ----/

TaskManager
  - Registry (task metadata + handlers)
  - SchedulerAdapter (cron engine wrapper)
  - Runner (guards, timeout, retry, metrics)
  - StateStore (in-memory runtime state)
  - Hooks/Events (logs + optional telemetry)
```

### Components

1. **TaskManager**
   - Public API for register/start/stop/runNow/list.
   - Owns task registry and runtime state.

2. **SchedulerAdapter**
   - Wraps cron library (`node-cron` or equivalent).
   - Converts cron expression + timezone into schedule handles.
   - Keeps cron dependency isolated for easier replacement/testing.

3. **TaskRunner**
   - Executes handlers with policies:
     - overlap control,
     - timeout,
     - retry/backoff,
     - jitter (optional),
     - instrumentation.

4. **StateStore (in-memory)**
   - Maintains state snapshot per task:
     - status (`idle|running|error|disabled`),
     - `lastStartedAt`, `lastFinishedAt`, `lastSuccessAt`, `lastError`,
     - run counters.

5. **Observability Hooks**
   - Structured logging and optional callback/event emitter for metrics sinks.

### Persistence Boundary (Important)

- **Task Manager runtime state is process-local and ephemeral.**
- **Task schedule intent must be persisted by Task Manager clients** (services/plugins/features) in their own storage.
- On server startup, each client:
  1. Loads its persisted schedule records.
  2. Rebuilds `TaskDefinition` objects.
  3. Re-registers them with `TaskManager.registerTask(s)` before `startAll()`.

This keeps Task Manager generic and stateless with respect to domain persistence, while still supporting restart safety through deterministic re-registration.

---

## 4) Data Model

```ts
export type OverlapPolicy = "skip" | "queue_one" | "parallel";

export interface TaskDefinition {
  id: string;                  // globally unique; stable across restarts
  description?: string;
  cron: string;                // cron expression
  timezone?: string;           // default: UTC
  enabled?: boolean;           // default: true

  overlapPolicy?: OverlapPolicy; // default: "skip"
  maxConcurrentRuns?: number;    // only meaningful with "parallel"; default: 5
  timeoutMs?: number;            // hard execution timeout
  maxRetries?: number;           // default: 0
  retryBackoffMs?: number;       // base backoff
  maxRetryBackoffMs?: number;    // cap for exponential backoff; default: 60_000
  jitterMs?: number;             // optional random delay before run

  tags?: string[];               // grouping/filtering

  run: (ctx: TaskRunContext) => Promise<void>;
}

export interface TaskRuntimeState {
  id: string;
  enabled: boolean;
  status: "idle" | "running" | "error" | "disabled";
  runningCount: number;
  queued: boolean;

  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastSuccessAt?: string;
  lastDurationMs?: number;

  runCount: number;
  successCount: number;
  errorCount: number;

  nextRunAt?: string;
  lastError?: {
    message: string;
    at: string;
  };
}

export interface TaskRunContext {
  signal: AbortSignal;
  now: () => Date;
  logger: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
  meta: {
    taskId: string;
    attempt: number;
    trigger: "cron" | "manual" | "startup";
  };
}
```

---

## 5) Public API (Server-Internal)

```ts
interface ITaskManager {
  registerTask(def: TaskDefinition): void;
  registerTasks(defs: TaskDefinition[]): void;
  removeTask(taskId: string): void;   // stop schedule + remove from registry

  startAll(): Promise<void>;     // bind cron schedules
  stopAll(): Promise<void>;      // stop schedules + wait/abort running

  runNow(taskId: string): Promise<void>;

  enableTask(taskId: string): void;
  disableTask(taskId: string): void;

  getTaskState(taskId: string): TaskRuntimeState | undefined;
  listTaskStates(): TaskRuntimeState[];
}
```

### Registration Pattern

Each feature service exports task definitions and registers them during server bootstrap.

For restart safety, each service is responsible for loading its own persisted schedule records first:

```ts
// startup/bootstrap pseudocode
const taskManager = createTaskManager({ logger, now: () => new Date(), shutdownTimeoutMs: 30_000 });

const reminderSchedules = await reminderScheduleRepo.loadAll(); // persisted by reminder domain
taskManager.registerTasks(createReminderTasks(deps, reminderSchedules));

const cleanupSchedules = await cleanupConfigRepo.loadAll(); // persisted by cleanup domain
taskManager.registerTasks(createCleanupTasks(deps, cleanupSchedules));

taskManager.registerTasks(createSyncTasks(deps)); // static schedule example

await taskManager.startAll();
```

### Removing Tasks

`removeTask(taskId)` stops the cron schedule and removes the task from the registry. If the task is currently running, it is aborted via its `AbortController`. Calling `removeTask` on a non-existent ID is a no-op (idempotent).

### Optional Upsert API for Dynamic Clients

To simplify re-registration flows for clients with mutable schedules, Task Manager can expose an optional helper:

```ts
upsertTask(def: TaskDefinition): void;
```

- `upsertTask` replaces existing registration for the same `id` atomically.
- Intended for boot-time replay and runtime schedule edits originating from client-owned persistence.
- If not implemented in v1, clients can emulate it with `disableTask/remove+register` semantics in a thin wrapper.

---

## 6) Execution Semantics

### 6.1 Overlap Policy

1. **skip** (default)
   - If already running, new trigger is skipped and logged.

2. **queue_one**
   - If running, keep a single queued flag. Additional triggers while queued are dropped.
   - When the current run finishes, execute one more time immediately using the current time (not the original trigger time).
   - If the current run errors, the queued run still fires (errors don't consume the queued slot).

3. **parallel**
   - Allow concurrent runs up to `maxConcurrentRuns` (default: 5).
   - If the limit is reached, additional triggers are skipped and logged.

### 6.2 Timeout

- If `timeoutMs` is set, run is wrapped with `AbortController` timeout.
- Handler should honor `signal` for cooperative cancellation.
- Timeout counts as failure and enters retry flow.

### 6.3 Retry

- Retries occur within same trigger execution chain.
- Delay formula: `min(retryBackoffMs * 2^(attempt-1), maxRetryBackoffMs)` where `maxRetryBackoffMs` defaults to 60 seconds.
- Retries emit structured events for observability.
- Note: if the process crashes during a retry backoff delay, the remaining retries are lost. This is acceptable given the non-goal of crash resilience; clients that need stronger guarantees should persist retry state in their own storage.

### 6.4 Jitter

- Optional random delay `[0, jitterMs]` before each trigger execution.
- Reduces synchronized bursts when many tasks share schedules.

---

## 7) Startup, Shutdown, and Lifecycle

## Startup
1. Construct `TaskManager` with logger + clock + `shutdownTimeoutMs` (default: 30 000).
2. Each client loads persisted schedule intent from its own store.
3. Register all tasks before serving traffic.
4. Validate task IDs and cron expressions.
5. Start scheduler handles for enabled tasks.
6. Optionally run a selected set with `trigger = "startup"`.

## Shutdown
1. Stop creating new scheduled triggers.
2. For running tasks:
   - wait up to `shutdownTimeoutMs` (default: 30 000),
   - then abort via `AbortController`.
3. Emit final shutdown summary log.

---

## 8) Error Handling Strategy

- All run errors are caught in `TaskRunner` boundary (never unhandled).
- Error metadata stored in task runtime state.
- Structured log fields:
  - `taskId`, `attempt`, `trigger`, `durationMs`, `errorMessage`.
- Failure in one task must not affect other schedules.

---

## 9) Observability and Operations

## Logging
Recommended events:
- `task.registered`
- `task.started`
- `task.succeeded`
- `task.failed`
- `task.skipped_overlap`
- `task.retried`
- `task.disabled` / `task.enabled`

## Runtime Introspection
Expose internal endpoint for debugging (optional v1.1):
- `GET /api/admin/tasks`
  - returns `listTaskStates()`.
- `POST /api/admin/tasks/:id/run`
  - manual trigger for ops.

(Endpoint should be protected if exposed beyond localhost/admin contexts.)

---

## 10) Validation Rules

At registration time:
- `id` must be non-empty and unique.
- `cron` must parse successfully.
- `run` must be a function.
- policy fields must be sane (e.g., `timeoutMs > 0` if provided).

On validation failure:
- fail fast during startup with clear error.

---

## 11) Example Task Definitions

```ts
// cleanup service
{
  id: "cleanup.sessions",
  description: "Delete expired sessions",
  cron: "*/10 * * * *", // every 10 minutes
  timezone: "UTC",
  overlapPolicy: "skip",
  timeoutMs: 20_000,
  maxRetries: 1,
  retryBackoffMs: 1000,
  run: async ({ signal, logger }) => {
    await sessionStore.deleteExpired({ signal });
    logger.info({ taskId: "cleanup.sessions" }, "expired sessions deleted");
  }
}

// digest service
{
  id: "digest.daily",
  cron: "0 13 * * *",
  timezone: "UTC",
  overlapPolicy: "queue_one",
  timeoutMs: 120_000,
  maxRetries: 2,
  retryBackoffMs: 5000,
  jitterMs: 30_000,
  run: async ({ signal }) => {
    await digestService.generateAndSend({ signal });
  }
}
```

---

## 12) File/Module Plan (Suggested)

```text
server/
  task-manager/
    index.ts               // createTaskManager + exported types
    types.ts               // TaskDefinition, TaskRuntimeState, etc.
    scheduler-adapter.ts   // cron wrapper
    runner.ts              // execution logic (timeout/retry/overlap)
    state-store.ts         // runtime state handling
```

Bootstrap integration:
- `server/index.ts` creates one TaskManager singleton.
- Each background-capable service owns persistence and exports:
  - `loadXxxSchedules()` (from domain storage),
  - `createXxxTasks(deps, schedules)` (maps persisted records to `TaskDefinition[]`).

---

## 13) Testing Strategy

## Unit Tests
1. Registration validation (duplicate IDs, invalid cron).
2. Overlap policies:
   - skip,
   - queue_one,
   - parallel.
3. Retry behavior and backoff math.
4. Timeout abort propagation.
5. State transitions on success/failure.

## Integration Tests
1. Start/stop lifecycle with fake scheduler adapter.
2. Multiple tasks running independently.
3. Manual `runNow` while scheduled triggers also fire.

## Fault Injection
- Simulate handler throw, slow handler, ignored abort.
- Ensure no unhandled promise rejections.

---

## 14) Rollout Plan

1. Implement TaskManager framework with no existing tasks migrated.
2. Define client persistence contract (what schedule intent each domain must store).
3. Migrate one low-risk task (e.g., cleanup) as pilot using persisted schedule replay.
4. Add task state endpoint for observability.
5. Migrate remaining cron services incrementally.
6. Remove legacy per-service timers.

---

## 15) Future Enhancements

1. Persistent run history (SQLite/file) for postmortems.
2. Global concurrency limits and per-tag throttling.
3. Leader-election/distributed lock for multi-instance deployments.
4. Config-driven schedules via workspace config file.
5. Pause windows / maintenance mode.

---

## 16) Decision Summary

This design centralizes cron execution in a reusable Task Manager that keeps feature services focused on domain logic while providing consistent lifecycle management, safer execution semantics, and better operational visibility. It is intentionally single-process and in-memory for v1. Persistence is handled by Task Manager clients, which store schedule intent and re-register tasks on restart, giving restart safety without coupling Task Manager to any specific storage model.
