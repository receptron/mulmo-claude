# Phase 3: User Tasks + Scheduler UI (#357)

## Goal

Enable users to create, manage, and monitor scheduled tasks through:
1. **API** — CRUD endpoints for user-created tasks in `config/scheduler/tasks.json`
2. **MCP tool** — Chat-driven task creation ("毎朝8時にニュースまとめて")
3. **UI** — Task list + execution log in the existing Scheduler plugin

## Current State (Phase 1 + 2 done)

- `@receptron/task-scheduler` — pure library with catch-up, persistence, state management
- `server/events/scheduler-adapter.ts` — wires library to MulmoClaude, registers system tasks
- `server/workspace/skills/scheduler.ts` — scans SKILL.md frontmatter, registers skill tasks
- `GET /api/scheduler/tasks` — read-only, returns system + skill tasks with state
- `GET /api/scheduler/logs` — execution log query
- Scheduler plugin (`src/plugins/scheduler/`) — calendar-style event/item manager (unrelated to task scheduler)

## Design Decisions

### User task persistence

- File: `config/scheduler/tasks.json` (array of `PersistedUserTask`)
- Loaded at server startup, registered with task-manager alongside system + skill tasks
- CRUD via API → file rewrite → task-manager re-registration (same pattern as skill refresh)

### Scheduler plugin: two modes

The existing Scheduler plugin is a calendar/event tool. Phase 3 adds a **"Tasks" tab** to the same plugin that shows the unified task registry (system + skill + user) with execution state and logs. The calendar view stays as-is.

### User task execution

User tasks fire `startChat()` like skill tasks — a chat session appears in the sidebar. The task's `prompt` field is the message sent to the agent.

## Data Model

```ts
interface PersistedUserTask {
  id: string;           // UUID
  name: string;
  description: string;
  schedule: TaskSchedule;
  missedRunPolicy: MissedRunPolicy;
  enabled: boolean;
  roleId: string;       // default: DEFAULT_ROLE_ID
  prompt: string;       // message sent to startChat
  createdAt: string;    // ISO UTC
  updatedAt: string;
}
```

## API Endpoints

```
POST   /api/scheduler/tasks           — create user task
PUT    /api/scheduler/tasks/:id       — update user task
DELETE /api/scheduler/tasks/:id       — delete user task (user-origin only)
POST   /api/scheduler/tasks/:id/run   — manual trigger (user tasks only)
```

Existing read endpoints stay unchanged:
```
GET    /api/scheduler/tasks           — all tasks + state (add origin field)
GET    /api/scheduler/logs            — execution log
```

## Implementation Steps

### Step 1: Backend — User task I/O + registration

1. Create `server/utils/files/user-tasks-io.ts`
   - `loadUserTasks(root?)` → `PersistedUserTask[]`
   - `saveUserTasks(tasks, root?)` → atomic write
2. Update `server/events/scheduler-adapter.ts`
   - Add `registerUserTasks(deps)` — load tasks.json, register each with task-manager
   - Each user task fires `startChat({ message: task.prompt, roleId, chatSessionId })`
   - Add `refreshUserTasks()` — re-scan after CRUD (same mutex pattern as skill refresh)
3. Update `server/index.ts` — call `registerUserTasks()` at startup after skill registration
4. Enhance `getSchedulerTasks()` — add `origin` field to response

### Step 2: Backend — CRUD API routes

1. Update `src/config/apiRoutes.ts` — add nested scheduler routes
2. Expand `server/api/routes/schedulerTasks.ts`:
   - `POST /api/scheduler/tasks` — validate, save to tasks.json, refresh
   - `PUT /api/scheduler/tasks/:id` — validate, update, refresh
   - `DELETE /api/scheduler/tasks/:id` — check origin=user, remove, refresh
   - `POST /api/scheduler/tasks/:id/run` — manual trigger via task-manager

### Step 3: MCP tool update

1. Update `src/plugins/scheduler/definition.ts` — add `createTask` / `deleteTask` / `listTasks` actions
2. Update `server/agent/mcp-server.ts` — wire new actions to the CRUD API
3. Server handler: parse schedule from natural language ("毎朝8時" → `{ type: "daily", time: "23:00" }` UTC)

### Step 4: UI — Tasks tab

1. Add "Tasks" tab to `src/plugins/scheduler/View.vue`
   - Task list with origin badges, schedule display, state indicators
   - Enable/disable toggle per task
   - "Run Now" button
   - Create/Edit/Delete for user tasks
2. Execution log panel (expandable per task)
   - Recent runs with result icons, duration, session links
3. Fetch data from `GET /api/scheduler/tasks` + `GET /api/scheduler/logs`

### Step 5: Tests

1. Unit tests for user-tasks-io (load/save/validation)
2. Unit tests for CRUD handlers (create/update/delete/run)
3. E2E test for task list display + create flow

## Out of Scope

- Timezone-aware datetime picker (Phase 3 stores UTC; user enters UTC times for now)
- Template variables `{{scheduledFor}}` / `{{scheduledDate}}` (documented in routines.md, deferred)
- Notification wiring (Phase 4, #144)
