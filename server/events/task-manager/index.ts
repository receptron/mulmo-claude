import { log } from "../../system/logger/index.js";
import { ONE_SECOND_MS, ONE_MINUTE_MS, ONE_HOUR_MS } from "../../utils/time.js";
import { SCHEDULE_TYPES } from "@receptron/task-scheduler";

export type TaskSchedule =
  | { type: typeof SCHEDULE_TYPES.interval; intervalMs: number }
  | { type: typeof SCHEDULE_TYPES.daily; time: string }; // time: "HH:MM" in UTC

export interface TaskRunContext {
  taskId: string;
  now: Date;
}

export interface TaskDefinition {
  id: string;
  description?: string;
  schedule: TaskSchedule;
  enabled?: boolean; // default: true
  run: (ctx: TaskRunContext) => Promise<void>;
}

export interface ITaskManager {
  registerTask(def: TaskDefinition): void;
  removeTask(taskId: string): void;
  start(): void;
  stop(): void;
  listTasks(): Array<{
    id: string;
    description?: string;
    schedule: TaskSchedule;
  }>;
}

export interface TaskManagerOptions {
  tickMs?: number; // default: ONE_MINUTE_MS
  now?: () => Date; // default: () => new Date()
}

function isDue(now: Date, schedule: TaskSchedule, tickMs: number): boolean {
  if (schedule.type === SCHEDULE_TYPES.interval) {
    const msSinceMidnight =
      now.getUTCHours() * ONE_HOUR_MS +
      now.getUTCMinutes() * ONE_MINUTE_MS +
      now.getUTCSeconds() * ONE_SECOND_MS;
    // Round down to tick boundary, then check if it aligns with the interval
    const rounded = Math.floor(msSinceMidnight / tickMs) * tickMs;
    return rounded % schedule.intervalMs === 0;
  }

  if (schedule.type === SCHEDULE_TYPES.daily) {
    const [hh, mm] = schedule.time.split(":").map(Number);
    const targetMs = hh * ONE_HOUR_MS + mm * ONE_MINUTE_MS;
    const msSinceMidnight =
      now.getUTCHours() * ONE_HOUR_MS +
      now.getUTCMinutes() * ONE_MINUTE_MS +
      now.getUTCSeconds() * ONE_SECOND_MS;
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

  function onTick() {
    const currentTime = now();
    for (const def of registry.values()) {
      if (def.enabled === false) continue;
      if (!isDue(currentTime, def.schedule, tickMs)) continue;

      def.run({ taskId: def.id, now: currentTime }).catch((err) => {
        log.error("task-manager", "task failed", {
          id: def.id,
          error: String(err),
        });
      });
    }
  }

  return {
    registerTask(def: TaskDefinition) {
      if (registry.has(def.id)) {
        throw new Error(
          `[task-manager] Task "${def.id}" is already registered`,
        );
      }
      registry.set(def.id, def);
      log.info("task-manager", "registered", { id: def.id });
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
      return [...registry.values()].map((d) => ({
        id: d.id,
        description: d.description,
        schedule: d.schedule,
      }));
    },
  };
}
