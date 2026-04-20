# feat: Intelligent task frequency (#465)

## Problem

Scheduled tasks have static frequencies. Users must manually choose intervals,
and there's no adjustment when a task's output is stale or the task is failing.

## Current infrastructure

- `TaskSchedule`: interval / daily / weekly / once
- `TaskExecutionState`: tracks `consecutiveFailures`, `totalRuns`, `lastRunResult`, `lastRunDurationMs`
- Schedule is fixed at registration time — no runtime adjustment
- System prompt has no scheduling guidance

## Design: 3 phases

### Phase 1: Prompt-based frequency hints

**Scope**: System prompt only — no code changes to scheduler.

Add a scheduling reference table to the system prompt so Claude recommends
appropriate frequencies when users ask to schedule tasks:

| Task type | Recommended schedule |
|---|---|
| News/RSS fetch | `interval 1h` |
| Journal daily pass | `daily 23:00` |
| Wiki maintenance | `cron 0 3 * * 0` (weekly) |
| Memory extraction | `daily 23:30` (after journal) |
| Calendar/contact sync | `interval 4h` |
| Source monitoring | `interval 2h` |

**Changes:**
- `server/agent/prompt.ts` — add scheduling guidance section with frequency table
- `server/workspace/skills/scheduler.ts` — no changes (skills already parse `schedule:` from SKILL.md)

### Phase 2: Adaptive frequency

**Scope**: Pure library + scheduler adapter integration.

Add an adaptive policy engine that adjusts intervals based on execution history.

**New type:**
```typescript
interface AdaptiveConfig {
  enabled: boolean;
  baseIntervalMs: number;      // original interval
  maxIntervalMs: number;       // upper bound (e.g. 24h)
  minIntervalMs: number;       // lower bound (e.g. 10min)
  backoffFactor: number;       // e.g. 2
  unchangedStreakThreshold: number; // e.g. 3 consecutive no-change runs
}
```

**New field in `TaskExecutionState`:**
```typescript
unchangedStreak: number;       // consecutive runs with no new output
currentIntervalMs?: number;    // adjusted interval (null = use base)
```

**Pure function** (`packages/scheduler/src/adaptive.ts`):
```typescript
function computeAdaptiveInterval(
  state: TaskExecutionState,
  config: AdaptiveConfig,
): number
```
- If `consecutiveFailures >= 3`: double interval (up to max)
- If `unchangedStreak >= threshold`: double interval (up to max)
- If new content detected (streak reset): return to base interval
- Minimum interval guard

**Integration** (`server/events/scheduler-adapter.ts`):
- After `executeAndLog()`, compute new interval
- If changed: re-register task with task-manager at new interval
- Log the adjustment

**"Unchanged" detection:**
- Task `run()` function returns a result payload
- Hash comparison of output vs previous run
- Configurable per task type

### Phase 3: Task dependencies (future)

Simple `dependsOn: taskId` field. After task A completes successfully,
task B becomes eligible to run in the next tick.

**Changes:**
- `TaskDefinition` gets optional `dependsOn?: string`
- `task-manager` tick loop checks dependency before firing
- Ordering: news fetch → journal → memory extraction

## Implementation order

1. **Phase 1** (prompt hints) — 1 file change, no risk
2. **Phase 2** (adaptive) — new pure module + adapter integration
3. **Phase 3** (dependencies) — task-manager modification

## Files to change

### Phase 1
| File | Change |
|---|---|
| `server/agent/prompt.ts` | Add scheduling guidance section |

### Phase 2
| File | Change |
|---|---|
| `packages/scheduler/src/types.ts` | Add `AdaptiveConfig`, extend `TaskExecutionState` |
| `packages/scheduler/src/adaptive.ts` | New: `computeAdaptiveInterval()` pure function |
| `packages/scheduler/test/test_adaptive.ts` | New: unit tests |
| `server/events/scheduler-adapter.ts` | Post-execution adaptive adjustment |

### Phase 3
| File | Change |
|---|---|
| `packages/scheduler/src/types.ts` | Add `dependsOn` to `TaskDefinition` |
| `server/events/task-manager/index.ts` | Dependency check in tick loop |

## Open questions

- "Unchanged output" detection: hash comparison is simple but requires tasks
  to return comparable output. LLM judgment is expensive. Start with hash.
- Should adaptive be opt-in per task? Yes — not all tasks benefit (e.g. daily
  journal should always be daily).
- Should Claude be able to change frequency via tool call? Phase 2 could expose
  an API endpoint for this.
