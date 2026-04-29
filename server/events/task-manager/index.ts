import { log } from "../../system/logger/index.js";
import { ONE_SECOND_MS, ONE_MINUTE_MS, ONE_HOUR_MS } from "../../utils/time.js";
import { SCHEDULE_TYPES } from "@receptron/task-scheduler";

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

export interface ITaskManager {
  registerTask: (def: TaskDefinition) => void;
  removeTask: (taskId: string) => void;
  /** Update the schedule of an existing task. Returns false if not found. */
  updateSchedule: (taskId: string, schedule: TaskSchedule) => boolean;
  start: () => void;
  stop: () => void;
  /** Run one tick manually (for testing). */
  tick: () => Promise<void>;
  listTasks: () => {
    id: string;
    description?: string;
    schedule: TaskSchedule;
    dependsOn?: string;
  }[];
}

export interface TaskManagerOptions {
  tickMs?: number; // default: ONE_MINUTE_MS
  now?: () => Date; // default: () => new Date()
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

export function createTaskManager(options?: TaskManagerOptions): ITaskManager {
  const tickMs = options?.tickMs ?? ONE_MINUTE_MS;
  const now = options?.now ?? (() => new Date());
  const registry = new Map<string, TaskDefinition>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function collectDueTasks(currentTime: Date): {
    independent: TaskDefinition[];
    dependent: TaskDefinition[];
  } {
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

  async function runAndTrack(def: TaskDefinition, currentTime: Date, succeeded: Set<string>): Promise<void> {
    try {
      await def.run({ taskId: def.id, now: currentTime });
      succeeded.add(def.id);
    } catch (err) {
      log.error("task-manager", "task failed", {
        id: def.id,
        error: String(err),
      });
    }
  }

  async function runDependentChain(dependent: TaskDefinition[], currentTime: Date, succeeded: Set<string>): Promise<void> {
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
        await runAndTrack(def, currentTime, succeeded);
        progress = true;
      }
      remaining = next;
    }
  }

  async function onTick(): Promise<void> {
    const currentTime = now();
    const { independent, dependent } = collectDueTasks(currentTime);

    // Per-invocation set — success does not leak across tick() calls.
    const succeeded = new Set<string>();

    await Promise.all(independent.map((def) => runAndTrack(def, currentTime, succeeded)));

    await runDependentChain(dependent, currentTime, succeeded);
  }

  return {
    async tick() {
      await onTick();
    },

    registerTask(def: TaskDefinition) {
      if (registry.has(def.id)) {
        throw new Error(`[task-manager] Task "${def.id}" is already registered`);
      }
      registry.set(def.id, def);
      log.info("task-manager", "registered", { id: def.id });
    },

    updateSchedule(taskId: string, schedule: TaskSchedule): boolean {
      const def = registry.get(taskId);
      if (!def) return false;
      def.schedule = schedule;
      log.info("task-manager", "schedule updated", { id: taskId });
      return true;
    },

    removeTask(taskId: string) {
      if (registry.delete(taskId)) {
        log.info("task-manager", "removed", { id: taskId });
      }
    },

    start() {
      if (timer) return;
      timer = setInterval(onTick, tickMs);
      log.info("task-manager", "started", { tickMs });
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        log.info("task-manager", "stopped");
      }
    },

    listTasks() {
      return [...registry.values()].map((taskDef) => ({
        id: taskDef.id,
        description: taskDef.description,
        schedule: taskDef.schedule,
        dependsOn: taskDef.dependsOn,
      }));
    },
  };
}
