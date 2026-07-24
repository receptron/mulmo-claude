// Generic dependency-ordered cron tick engine. Host-agnostic: the only
// host coupling (a logger) is injected via options. Schedules are either
// fixed intervals or a daily UTC time; tasks may declare a `dependsOn`
// edge so an ordering like "news fetch → journal → memory extraction"
// runs in sequence within one tick.

import type { MinimalLogger } from "@mulmoclaude/common";
import { SCHEDULE_TYPES } from "@receptron/task-scheduler";

const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

// Gap between the START of each independently-due task within one tick. When
// many tasks come due at the same minute (system journal + feed-refresh + a few
// user tasks all at 20:00 UTC), firing every chat in the same event-loop turn
// floods the machine; the mulmoclaude MCP broker each chat spawns then boots
// under contention and can lose the startup race to the CLI's first tool call,
// so that turn fails with `handlePermission not found` (#2057). Spacing the
// launches by a second gives each broker room to connect. Far under one tick
// (a handful of tasks spread over a few seconds), so nothing is delayed past
// its window.
const DEFAULT_FIRING_STAGGER_MS = ONE_SECOND_MS;

// The total stagger must stay well inside one tick, or the tail tasks start in a
// LATER tick window and two ticks overlap. Cap all starts to this fraction of
// `tickMs` regardless of task count or the configured gap — this keeps a debug
// `tickMs === firingStaggerMs` (see server boot) from degenerating.
const MAX_STAGGER_FRACTION_OF_TICK = 0.5;

const realSleep = (delayMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, delayMs));

// Per-task stagger step: the configured gap, shrunk so the last of `count` tasks
// still starts within MAX_STAGGER_FRACTION_OF_TICK of the tick. 0 disables it.
function staggerStepMs(staggerMs: number, tickMs: number, count: number): number {
  if (staggerMs <= 0 || count <= 1) return 0;
  const maxStepMs = (tickMs * MAX_STAGGER_FRACTION_OF_TICK) / (count - 1);
  return Math.min(staggerMs, maxStepMs);
}

/** Minimal logger the engine logs through. Absent one, runs silent. */
export type SchedulerLogger = MinimalLogger;

const NOOP_LOG: SchedulerLogger = { info: () => {}, warn: () => {}, error: () => {} };

export type TaskSchedule = { type: typeof SCHEDULE_TYPES.interval; intervalMs: number } | { type: typeof SCHEDULE_TYPES.daily; time: string }; // time: "HH:MM" in UTC

export interface TaskRunContext {
  taskId: string;
  now: Date;
}

export interface TaskDefinition {
  id: string;
  description?: string;
  schedule: TaskSchedule;
  enabled?: boolean; // default: true
  /** If set, this task only fires after the named task has completed
   *  successfully in the current tick cycle. Enforces ordering like
   *  "news fetch → journal → memory extraction". */
  dependsOn?: string;
  run: (ctx: TaskRunContext) => Promise<void>;
}

export interface TaskSummary {
  id: string;
  description?: string;
  schedule: TaskSchedule;
  dependsOn?: string;
}

export interface ITaskManager {
  registerTask: (def: TaskDefinition) => void;
  removeTask: (taskId: string) => void;
  /** Update the schedule of an existing task. Returns false if not found. */
  updateSchedule: (taskId: string, schedule: TaskSchedule) => boolean;
  start: () => void;
  stop: () => void;
  /** Run one tick manually (for testing). */
  tick: () => Promise<void>;
  listTasks: () => TaskSummary[];
}

export interface TaskManagerOptions {
  tickMs?: number; // default: ONE_MINUTE_MS
  now?: () => Date; // default: () => new Date()
  log?: SchedulerLogger; // default: noop
  /** Gap between the start of each independently-due task in a tick (#2057).
   *  Default DEFAULT_FIRING_STAGGER_MS; 0 fires them all at once. */
  firingStaggerMs?: number;
  /** Injected so tests advance time without real timers. Default setTimeout. */
  sleep?: (delayMs: number) => Promise<void>;
}

function isDue(now: Date, schedule: TaskSchedule, tickMs: number): boolean {
  if (schedule.type === SCHEDULE_TYPES.interval) {
    const msSinceMidnight = now.getUTCHours() * ONE_HOUR_MS + now.getUTCMinutes() * ONE_MINUTE_MS + now.getUTCSeconds() * ONE_SECOND_MS;
    // Round down to tick boundary, then check if it aligns with the interval
    const rounded = Math.floor(msSinceMidnight / tickMs) * tickMs;
    return rounded % schedule.intervalMs === 0;
  }

  if (schedule.type === SCHEDULE_TYPES.daily) {
    const [hours, minutes] = schedule.time.split(":").map(Number);
    const targetMs = hours * ONE_HOUR_MS + minutes * ONE_MINUTE_MS;
    const msSinceMidnight = now.getUTCHours() * ONE_HOUR_MS + now.getUTCMinutes() * ONE_MINUTE_MS + now.getUTCSeconds() * ONE_SECOND_MS;
    const rounded = Math.floor(msSinceMidnight / tickMs) * tickMs;
    return rounded === targetMs;
  }

  return false;
}

/** Split the due tasks into those that may run immediately and those gated
 *  behind a `dependsOn` edge (resolved later in the same tick cycle). */
export function collectDueTasks(
  currentTime: Date,
  registry: Map<string, TaskDefinition>,
  tickMs: number,
): { independent: TaskDefinition[]; dependent: TaskDefinition[] } {
  const independent: TaskDefinition[] = [];
  const dependent: TaskDefinition[] = [];
  for (const def of registry.values()) {
    if (def.enabled === false) continue;
    if (!isDue(currentTime, def.schedule, tickMs)) continue;
    if (def.dependsOn) {
      dependent.push(def);
    } else {
      independent.push(def);
    }
  }
  return { independent, dependent };
}

async function runAndTrack(def: TaskDefinition, currentTime: Date, succeeded: Set<string>, log: SchedulerLogger): Promise<void> {
  try {
    await def.run({ taskId: def.id, now: currentTime });
    succeeded.add(def.id);
  } catch (err) {
    log.error("task failed", {
      id: def.id,
      error: String(err),
    });
  }
}

async function runDependentChain(dependent: TaskDefinition[], currentTime: Date, succeeded: Set<string>, log: SchedulerLogger): Promise<void> {
  let remaining = [...dependent];
  let progress = true;
  while (remaining.length > 0 && progress) {
    progress = false;
    const next: TaskDefinition[] = [];
    for (const def of remaining) {
      const dep = def.dependsOn;
      if (!dep || !succeeded.has(dep)) {
        next.push(def);
        continue;
      }
      await runAndTrack(def, currentTime, succeeded, log);
      progress = true;
    }
    remaining = next;
  }
}

interface TickConfig {
  tickMs: number;
  staggerMs: number;
  sleep: (delayMs: number) => Promise<void>;
  log: SchedulerLogger;
}

async function runTick(now: () => Date, registry: Map<string, TaskDefinition>, cfg: TickConfig): Promise<void> {
  const currentTime = now();
  const { independent, dependent } = collectDueTasks(currentTime, registry, cfg.tickMs);

  // Per-invocation set — success does not leak across tick() calls.
  const succeeded = new Set<string>();

  // Staggered start (#2057), still concurrent: each fires after its own capped
  // delay but the tick awaits them all, preserving the previous "all due tasks
  // ran this tick" contract.
  const stepMs = staggerStepMs(cfg.staggerMs, cfg.tickMs, independent.length);
  await Promise.all(
    independent.map(async (def, index) => {
      if (stepMs > 0 && index > 0) await cfg.sleep(index * stepMs);
      await runAndTrack(def, currentTime, succeeded, cfg.log);
    }),
  );

  await runDependentChain(dependent, currentTime, succeeded, cfg.log);
}

export function listTaskSummaries(registry: Map<string, TaskDefinition>): TaskSummary[] {
  return [...registry.values()].map((taskDef) => ({
    id: taskDef.id,
    description: taskDef.description,
    schedule: taskDef.schedule,
    dependsOn: taskDef.dependsOn,
  }));
}

// A tick runner that skips re-entry: if the previous tick is still draining its
// staggered starts, drop this one so a slow tick + short tickMs can never run
// two ticks concurrently.
function makeGuardedTick(now: () => Date, registry: Map<string, TaskDefinition>, cfg: TickConfig): () => Promise<void> {
  let ticking = false;
  return async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runTick(now, registry, cfg);
    } finally {
      ticking = false;
    }
  };
}

function resolveTickConfig(options?: TaskManagerOptions): { tickMs: number; now: () => Date; cfg: TickConfig } {
  const tickMs = options?.tickMs ?? ONE_MINUTE_MS;
  return {
    tickMs,
    now: options?.now ?? (() => new Date()),
    cfg: {
      tickMs,
      staggerMs: options?.firingStaggerMs ?? DEFAULT_FIRING_STAGGER_MS,
      sleep: options?.sleep ?? realSleep,
      log: options?.log ?? NOOP_LOG,
    },
  };
}

export function createTaskManager(options?: TaskManagerOptions): ITaskManager {
  const { tickMs, now, cfg } = resolveTickConfig(options);
  const { log } = cfg;
  const registry = new Map<string, TaskDefinition>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const onTick = makeGuardedTick(now, registry, cfg);

  return {
    async tick() {
      await onTick();
    },

    registerTask(def: TaskDefinition) {
      if (registry.has(def.id)) {
        throw new Error(`[task-manager] Task "${def.id}" is already registered`);
      }
      registry.set(def.id, def);
      log.info("registered", { id: def.id });
    },

    updateSchedule(taskId: string, schedule: TaskSchedule): boolean {
      const def = registry.get(taskId);
      if (!def) return false;
      def.schedule = schedule;
      log.info("schedule updated", { id: taskId });
      return true;
    },

    removeTask(taskId: string) {
      if (registry.delete(taskId)) {
        log.info("removed", { id: taskId });
      }
    },

    start() {
      if (timer) return;
      // `onTick` guards re-entry but not failure — it has a `finally`, no
      // `catch` — so handing it straight to setInterval let a rejected tick
      // escape as an unhandled rejection, which the host turns into a process
      // exit. The scheduler must outlive one bad tick.
      timer = setInterval(() => {
        onTick().catch((err: unknown) => log.error("tick failed", { error: String(err) }));
      }, tickMs);
      log.info("started", { tickMs });
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        log.info("stopped");
      }
    },

    listTasks() {
      return listTaskSummaries(registry);
    },
  };
}
