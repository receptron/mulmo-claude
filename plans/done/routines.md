# Routines — Design Document

## 1) Overview

A **Routine** is a user-defined recurring job that invokes the LLM agent on a schedule. Examples:

- "Search X on topic related to OpenAI, and write the summary article on Office role at 4am Pacific time everyday"
- "Summarize my calendar events for today at 8am"
- "Check my todos and send a digest every Monday at 9am"

Routines sit on top of the Task Manager. Each routine is a persistent record stored in `{workspace}/tasks/tasks.json`. On server boot, routines are loaded from this file and registered with the Task Manager. The Task Manager handles the scheduling; Routines handles persistence and LLM invocation.

---

## 2) Design Goals and Non-Goals

### Goals
1. **Persistent** — routines survive server restarts via `tasks.json`.
2. **LLM-driven** — each routine invokes `runAgent()` with a role and prompt.
3. **Simple storage** — one JSON file, no database.
4. **Registerable by user or LLM** — via REST API or tool call.

### Non-Goals
1. Cron expressions — use typed schedule variants instead.
2. Output routing (email, notification, etc.) — output goes to a chat session file in `workspace/chat/`.

---

## 3) Data Model

```ts
// Routine-level schedule types — richer than TaskSchedule.
// The routines layer translates these down to TaskSchedule for the task manager.
type RoutineSchedule =
  | { type: "daily"; time: string }                          // "HH:MM" in UTC
  | { type: "interval"; intervalMs: number }
  | { type: "weekly"; daysOfWeek: number[]; time: string }   // daysOfWeek: 0=Sun..6=Sat, time: "HH:MM" UTC
  | { type: "once"; at: string };                            // ISO 8601 timestamp

interface Routine {
  id: string;                    // unique, stable across restarts (e.g., UUID)
  name: string;                  // human-readable label
  roleId: string;                // which role to invoke (e.g., "office", "general")
  prompt: string;                // the message sent to the agent
  schedule: RoutineSchedule;
  enabled: boolean;              // can be toggled without deleting
  createdAt: string;             // ISO timestamp
}
```

### Mapping to TaskSchedule

The task manager only understands `interval` and `daily`. The routines layer handles the translation:

| RoutineSchedule | TaskSchedule | Notes |
|---|---|---|
| `daily` | `daily` | Pass through as-is |
| `interval` | `interval` | Pass through as-is |
| `weekly` | `daily` | Register as daily; the `run()` callback checks `now.getUTCDay()` against `daysOfWeek` and skips non-matching days |
| `once` | `interval: 60_000` | Register with 1-minute interval; the `run()` callback checks if `now >= at`, fires once, then calls `removeTask()` to self-unregister |

This keeps the task manager simple while supporting richer schedules at the routines layer.

### `tasks.json` format

```json
{
  "routines": [
    {
      "id": "a1b2c3",
      "name": "Daily OpenAI summary",
      "roleId": "office",
      "prompt": "Search X on topic related to OpenAI, and write the summary article.",
      "schedule": { "type": "daily", "time": "11:00" },
      "enabled": true,
      "createdAt": "2026-04-11T00:00:00Z"
    },
    {
      "id": "d4e5f6",
      "name": "One-time reminder",
      "roleId": "general",
      "prompt": "Remind me about the design review meeting.",
      "schedule": { "type": "once", "at": "2026-04-15T21:00:00Z" },
      "enabled": true,
      "createdAt": "2026-04-11T00:00:00Z"
    },
    {
      "id": "g7h8i9",
      "name": "MWF evening digest",
      "roleId": "office",
      "prompt": "Summarize today's activity.",
      "schedule": { "type": "weekly", "daysOfWeek": [1, 3, 5], "time": "18:00" },
      "enabled": true,
      "createdAt": "2026-04-11T00:00:00Z"
    }
  ]
}
```

Note: `schedule.time` for daily/weekly is in UTC. The API layer converts user-specified local time (e.g., "4am Pacific") to UTC before storing.

---

## 4) Architecture

```text
tasks.json (persistence)
    ↕ load/save
Routines module
    ↕ registerTask / removeTask
Task Manager (scheduling)
    ↕ tick fires run()
runAgent() (LLM invocation)
    ↕ output
workspace/chat/{sessionId}.jsonl
```

### Boot sequence

1. Server starts, creates Task Manager.
2. Routines module loads `tasks.json`.
3. For each enabled routine, registers a task with the Task Manager whose `run()` calls `runAgent()`.
4. Task Manager `start()` begins ticking.

### Runtime changes

When a routine is created/updated/deleted via API:
1. Update the in-memory list.
2. Write `tasks.json` to disk.
3. Call `removeTask()` / `registerTask()` on the Task Manager to sync.

---

## 5) Server API

```ts
// POST /api/routines         — create a routine
// GET  /api/routines         — list all routines
// PUT  /api/routines/:id     — update a routine
// DELETE /api/routines/:id   — delete a routine
```

### Create

```ts
interface CreateRoutineBody {
  name: string;
  roleId: string;
  prompt: string;
  schedule: TaskSchedule;
  enabled?: boolean;             // default: true
}
```

Returns the created `Routine` with generated `id` and `createdAt`.

### Update

Accepts partial fields. If `schedule` or `enabled` changes, the corresponding Task Manager registration is updated (remove + re-register).

### Delete

Removes from `tasks.json` and calls `removeTask()` on the Task Manager.

---

## 6) MCP Tool — manageRoutines

Expose routines as an MCP tool so the LLM can create, list, and delete routines during a conversation. For example, the user says "remind me to check OpenAI news every morning at 9am" and the LLM calls this tool directly.

### Tool Definition

```ts
{
  name: "manageRoutines",
  description: "Create, list, or delete scheduled routines that run automatically.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "list", "delete"],
      },
      // For "create":
      name: { type: "string" },
      roleId: { type: "string" },
      prompt: { type: "string" },
      scheduleType: { type: "string", enum: ["daily", "interval", "weekly", "once"] },
      time: { type: "string", description: "HH:MM in UTC (for daily/weekly)" },
      intervalMs: { type: "number", description: "Milliseconds (for interval)" },
      daysOfWeek: { type: "array", items: { type: "number" }, description: "0=Sun..6=Sat (for weekly)" },
      at: { type: "string", description: "ISO 8601 timestamp (for once)" },
      // For "delete":
      id: { type: "string" },
    },
    required: ["action"],
  },
}
```

### Behavior

- **create** — calls `POST /api/routines` internally. Returns the created routine.
- **list** — calls `GET /api/routines`. Returns all routines.
- **delete** — calls `DELETE /api/routines/:id`. Returns confirmation.

The tool calls the same REST endpoints as the UI, so behavior is identical. The tool should be added to roles that need scheduling capability (e.g., "general", "office").

---

## 7) LLM Execution (when a routine fires)

When the Task Manager fires a routine's task:

```ts
async function executeRoutine(routine: Routine, pubsub: IPubSub): Promise<void> {
  const role = getRole(routine.roleId);
  const sessionId = uuidv4();

  // Notify the client that a new session has started
  pubsub.publish("sessions", {
    event: "session.started",
    sessionId,
    routineId: routine.id,
    routineName: routine.name,
    roleId: routine.roleId,
  });

  for await (const event of runAgent(
    routine.prompt,
    role,
    workspacePath,
    sessionId,
    PORT,
  )) {
    // Agent events (text, tool_result, status, etc.) are forwarded to the client
    // so the UI updates in real time, just like a user-initiated session.
    pubsub.publish("sessions", { event: "agent.event", sessionId, data: event });
  }

  // Notify the client that the session is complete
  pubsub.publish("sessions", {
    event: "session.completed",
    sessionId,
    routineId: routine.id,
  });
}
```

A routine creates a real chat session — the same as if the user had typed the prompt. The conversation is recorded in `workspace/chat/{sessionId}.jsonl` and the session metadata in `workspace/chat/{sessionId}.json`, exactly like any other session.

The client subscribes to the `"sessions"` pub/sub channel. When a routine fires:
1. `session.started` — the session list updates to show a new active session (with the routine name and role).
2. `agent.event` — streamed events update the conversation in real time. If the user switches to this session, they see it progressing live.
3. `session.completed` — the session is marked as finished.

This means the user can open the app, see a routine's session appear in the sidebar, click on it, and watch it work — or review the results later. There is no distinction in the UI between a user-initiated session and a routine-initiated session.

---

## 8) Execution History

Each routine execution is recorded in `{workspace}/tasks/history.json` so users can see past runs and jump to the corresponding chat session.

### Data Model

Each entry is a pointer from a routine to the chat session it created. All other details (role, timestamps, conversation content) live in the chat session record itself.

```ts
interface RoutineExecution {
  routineId: string;             // which routine ran
  sessionId: string;             // pointer to workspace/chat/{sessionId}.*
}
```

### `history.json` format

```json
{
  "executions": [
    { "routineId": "a1b2c3", "sessionId": "d4e5f6-..." },
    { "routineId": "a1b2c3", "sessionId": "g7h8i9-..." }
  ]
}
```

The array is append-only. Newest entries are appended to the end. A reasonable cap (e.g., keep the last 500 entries) prevents unbounded growth.

### Recording

In `executeRoutine()`, append the pointer after the agent finishes:

```ts
appendExecution({ routineId: routine.id, sessionId });
```

### Server API

```ts
// GET /api/routines/history              — list all executions (newest first)
// GET /api/routines/history?routineId=X  — filter by routine
```

---

## 9) UI — Routines Tab

The Routines view is a fourth tab in the canvas area's `CanvasViewToggle`, alongside Single, Stack, and Files.

### CanvasViewToggle changes

Add a new mode to `CanvasViewMode`:
```ts
export type CanvasViewMode = "single" | "stack" | "files" | "routines";
```

New button in the toggle bar:
- Icon: `schedule` (Material Icons)
- Label: "Routines"
- Shortcut: `Cmd/Ctrl + 4`

### RoutinesView component

`src/components/RoutinesView.vue` — rendered when `canvasViewMode === "routines"`.

**Layout:**
- Top: "Add Routine" button
- Below: list of all routines as cards

**Each routine card shows:**
- Name
- Role (icon + name)
- Prompt (truncated)
- Schedule (e.g., "Daily at 4:00 AM PT" or "Every 4 hours")
- Enabled toggle switch
- Edit / Delete buttons
- Expandable **execution history** — recent runs with timestamp, status (success/error), and a "View" link that switches to the chat session

**Add / Edit form (inline or modal):**
- Name (text input)
- Role (dropdown — populated from available roles)
- Prompt (textarea)
- Schedule type (daily / interval / weekly / once)
  - Daily: time picker + timezone selector
  - Interval: number input + unit selector (minutes / hours)
  - Weekly: day-of-week checkboxes + time picker + timezone selector
  - Once: date-time picker + timezone selector
- Enabled checkbox

**Actions:**
- Toggle enabled → `PUT /api/routines/:id` with `{ enabled: !current }`
- Delete → `DELETE /api/routines/:id` with confirmation
- Save (create/edit) → `POST /api/routines` or `PUT /api/routines/:id`

All actions call the REST API; the routines list is refreshed after each mutation.

---

## 10) File/Module Plan

```text
server/
  routines/
    index.ts                // loadRoutines, createRoutine, deleteRoutine, etc.
    types.ts                // Routine interface
  routes/
    routines.ts             // REST endpoints

src/
  plugins/
    manageRoutines/         // MCP tool for LLM to create/list/delete routines
      definition.ts
      index.ts
  components/
    RoutinesView.vue        // Routines tab content
  utils/
    canvas/
      viewMode.ts           // add "routines" to CanvasViewMode

workspace/
  tasks/
    tasks.json              // persisted routines
    history.json            // execution history
```

Follow the standard local plugin registration path (see CLAUDE.md "Adding a local plugin").

The `tasks` subdirectory needs to be added to `SUBDIRS` in `server/workspace.ts`.

---

## 11) Required Changes to Task Manager

The current Task Manager works as-is for Routines. No changes to its API or scheduling logic are needed.

One consideration: the Task Manager currently throws if a task ID is already registered. On boot, if `tasks.json` has routines and they are registered before `start()`, this is fine. But if the Routines module tries to re-register after a hot reload (e.g., during development), it would throw. Two options:

- **Option A**: Add an `upsertTask()` method to the Task Manager that replaces if exists.
- **Option B**: Always call `removeTask()` before `registerTask()` in the Routines module.

Option B requires no Task Manager changes. Prefer Option B for now.

---

## 12) Timezone Handling

Users specify times in local time (e.g., "4am Pacific"). The Routines API converts to UTC before storing in `tasks.json`. The Task Manager only deals with UTC.

Conversion happens in the API layer using standard `Intl.DateTimeFormat` or a helper function. The stored `schedule.time` is always UTC `"HH:MM"`.

The original user-specified time and timezone could optionally be stored as metadata for display purposes, but the scheduling logic only sees UTC.

---

## 13) Decision Summary

Routines is a thin persistence and LLM-invocation layer on top of the Task Manager. It owns `tasks.json` for storage, converts user schedules to UTC, and registers tasks whose `run()` calls `runAgent()`. The Task Manager is unchanged — it just sees normal task definitions. Output goes to `workspace/chat/` as regular sessions.
