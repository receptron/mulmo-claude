// Domain I/O for scheduler override config.
//
// Reads/writes config/scheduler/overrides.json. Each key is a
// system task ID (e.g. "system:journal"), value overrides the
// default schedule.

import fs from "fs";
import path from "path";
import { workspacePath } from "../../workspace/paths.js";
import { WORKSPACE_FILES } from "../../../src/config/workspacePaths.js";
import { loadJsonFile } from "./json.js";
import { writeFileAtomicSync } from "./atomic.js";
import { log } from "../../system/logger/index.js";
import { isRecord } from "../types.js";

export interface ScheduleOverride {
  /** Override interval in milliseconds (for interval-type schedules). */
  intervalMs?: number;
  /** Override time "HH:MM" in UTC (for daily-type schedules). */
  time?: string;
}

export type ScheduleOverrides = Record<string, ScheduleOverride>;

/** Strict HH:MM validation — rejects 99:99 etc. */
export const UTC_HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isScheduleOverride(value: unknown): value is ScheduleOverride {
  if (!isRecord(value)) return false;
  const obj = value;
  const hasInterval = "intervalMs" in obj && typeof obj.intervalMs === "number" && obj.intervalMs > 0;
  const hasTime = "time" in obj && typeof obj.time === "string" && UTC_HH_MM_RE.test(obj.time);
  // At least one valid field required
  return hasInterval || hasTime;
}

function overridesPath(root?: string): string {
  return path.join(root ?? workspacePath, WORKSPACE_FILES.schedulerOverrides);
}

/** Load schedule overrides. Filters out invalid entries with a warning. */
export function loadSchedulerOverrides(root?: string): ScheduleOverrides {
  const raw = loadJsonFile<unknown>(overridesPath(root), {});
  if (!isRecord(raw)) {
    log.warn("scheduler-overrides", "overrides.json is not an object");
    return {};
  }
  const result: ScheduleOverrides = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isScheduleOverride(value)) {
      result[key] = value;
    } else {
      log.warn("scheduler-overrides", "invalid entry, skipping", { key });
    }
  }
  return result;
}

/** Save schedule overrides atomically. Creates directory if needed. */
export function saveSchedulerOverrides(overrides: ScheduleOverrides, root?: string): void {
  const filePath = overridesPath(root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileAtomicSync(filePath, JSON.stringify(overrides, null, 2));
}
