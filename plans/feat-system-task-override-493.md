# feat: System task schedule overrides (#493)

## Problem

System tasks (journal, chat-index) have schedules hardcoded in server/index.ts.
Users cannot change their frequency without editing code.

## Design

### Config file: `config/scheduler/overrides.json`

```json
{
  "system:journal": { "intervalMs": 7200000 },
  "system:chat-index": { "intervalMs": 3600000 }
}
```

- Only `intervalMs` and `time` (for daily) are overridable
- Missing entries → use code default
- Invalid entries → log warning, use code default

### Implementation

1. Add `WORKSPACE_FILES.schedulerOverrides` constant
2. Create `server/utils/files/scheduler-overrides-io.ts` — load/save
3. Modify `server/index.ts` — apply overrides before `initScheduler`
4. Add API endpoints for reading/writing overrides
5. UI: Scheduler TasksTab shows editable schedule for system tasks

### Files

| File | Change |
|---|---|
| `src/config/workspacePaths.ts` | Add `schedulerOverrides` |
| `server/utils/files/scheduler-overrides-io.ts` | New: load/save |
| `server/index.ts` | Apply overrides to systemTasks |
| `test/events/test_scheduler_overrides.ts` | New: unit tests |
