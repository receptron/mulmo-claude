# Debug Mode — Design Document

## 1) Overview

The `--debug` flag activates debug mode for the server. It changes timing parameters and registers test fixtures that exercise background infrastructure end-to-end on startup.

### Activation

```bash
tsx server/index.ts --debug
```

Or in package.json:
```json
"dev:server:debug": "tsx server/index.ts --debug"
```

Detection in code:
```ts
const debug = process.argv.includes("--debug");
```

---

## 2) Effects

### Task Manager

When `--debug` is active:
1. **Tick interval is 1 second** instead of 60 seconds.
2. Two **counter test tasks** run in sequence:
   - **`debug.counter`** — every 1 second, 10 runs. On its last run, it registers the second task.
   - **`debug.counter2`** — every 2 seconds, 10 runs.
   - Both publish to the `"debug.beat"` channel and self-unregister after 10 runs.

### Pub/Sub

Both counter tasks publish to `"debug.beat"` on each run:
```ts
pubsub.publish("debug.beat", { count: N, last: N === 10 });
```

This exercises the full stack end-to-end: task manager tick → task execution → pub/sub publish → WebSocket delivery → client UI update. The two-task sequence also tests dynamic task registration (registering a new task from within a running task's callback).

### Client

The client subscribes to `"debug.beat"` on startup. On each message, it alternates the color of the "MulmoClaude" title text based on whether `count` is odd or even. This provides immediate visual confirmation that the server → client push pipeline is working.

When the client receives a message with `last: true`, it resets the title to its default color.

---

## 3) Bootstrap

```ts
// server/index.ts
const debug = process.argv.includes("--debug");

const taskManager = createTaskManager({
  tickMs: debug ? 1_000 : 60_000,
});

// ... register production tasks ...

if (debug) {
  registerDebugTasks(taskManager, pubsub);
}

taskManager.start();
```

The `registerDebugTasks` function lives alongside the task manager or in a dedicated debug module. It receives both the task manager and pub/sub so it can exercise both systems.

---

## 4) Future Debug Fixtures

As new infrastructure is added, `--debug` can register additional test fixtures following the same pattern — self-contained, self-cleaning, and exercising the full stack on startup. Each fixture should log with a `[debug]` prefix and clean up after itself.
