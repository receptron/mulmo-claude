// Skill scheduling (#357 Phase 2). Scans all discovered skills for
// `schedule:` frontmatter and registers matching ones with the
// task-manager. Each scheduled skill fires `startChat()` with the
// skill body as the message and the skill's `roleId` (or "general").
//
// `refreshScheduledSkills()` can be called at any time to re-scan
// and update registrations (e.g. after a skill is saved/deleted
// via the API). It unregisters stale tasks and registers new ones.

import { discoverSkills } from "./discovery.js";
import type { Skill } from "./types.js";
import type { ITaskManager, TaskSchedule } from "../../events/task-manager/index.js";
import { parseSkillFrontmatter } from "./parser.js";
import { log } from "../../system/logger/index.js";
import { readFileSync } from "fs";
import { DEFAULT_ROLE_ID } from "../../../src/config/roles.js";
import { SESSION_ORIGINS, type SessionOrigin } from "../../../src/types/session.js";

interface SkillScheduleInfo {
  schedule: TaskSchedule;
  roleId: string;
}

interface StartChatResult {
  kind: string;
  error?: string;
  status?: number;
}

export interface SkillSchedulerDeps {
  taskManager: ITaskManager;
  workspaceRoot: string;
  startChat: (params: { message: string; roleId: string; chatSessionId: string; origin?: SessionOrigin }) => Promise<StartChatResult>;
}

const SKILL_TASK_PREFIX = "skill.";

// Track registered skill task IDs so refresh can unregister stale ones.
let registeredTaskIds = new Set<string>();
let cachedDeps: SkillSchedulerDeps | null = null;

// Mutex: serialize refresh calls so concurrent save/update/delete
// API calls don't interleave register/unregister and corrupt state.
let refreshMutex: Promise<number> = Promise.resolve(0);

export async function registerScheduledSkills(deps: SkillSchedulerDeps): Promise<number> {
  cachedDeps = deps;
  return serializedRefresh(deps);
}

/**
 * Re-scan skills and update task-manager registrations. Safe to call
 * after a skill is saved, updated, or deleted — removes stale tasks
 * and adds new ones without a server restart. Serialized: concurrent
 * calls queue behind the in-flight one.
 */
export async function refreshScheduledSkills(): Promise<number> {
  if (!cachedDeps) {
    log.warn("skills", "refreshScheduledSkills called before initial register");
    return 0;
  }
  return serializedRefresh(cachedDeps);
}

function serializedRefresh(deps: SkillSchedulerDeps): Promise<number> {
  refreshMutex = refreshMutex.then(
    () => doRegister(deps),
    () => doRegister(deps),
  );
  return refreshMutex;
}

async function doRegister(deps: SkillSchedulerDeps): Promise<number> {
  const { taskManager, workspaceRoot, startChat } = deps;

  // Unregister all previously registered skill tasks
  for (const taskId of registeredTaskIds) {
    taskManager.removeTask(taskId);
  }
  const previousCount = registeredTaskIds.size;
  registeredTaskIds = new Set<string>();

  const skills = await discoverSkills({ workspaceRoot });
  let registered = 0;

  for (const skill of skills) {
    const info = readSkillScheduleInfo(skill);
    if (!info) continue;

    const { schedule, roleId } = info;
    const taskId = `${SKILL_TASK_PREFIX}${skill.name}`;

    taskManager.registerTask({
      id: taskId,
      description: `Scheduled skill: ${skill.name} — ${skill.description}`,
      schedule,
      run: async () => {
        const chatSessionId = crypto.randomUUID();
        log.info("skills", "running scheduled skill", {
          name: skill.name,
          roleId,
          chatSessionId,
        });
        const result = await startChat({
          message: `/${skill.name}`,
          roleId,
          chatSessionId,
          origin: SESSION_ORIGINS.skill,
        });
        if (result.kind === "error") {
          throw new Error(`scheduled skill failed: ${result.error ?? "unknown"}`);
        }
        log.info("skills", "scheduled skill completed", {
          name: skill.name,
          kind: result.kind,
        });
      },
    });

    registeredTaskIds.add(taskId);
    registered++;
  }

  if (previousCount > 0 || registered > 0) {
    log.info("skills", "skill schedules refreshed", {
      previous: previousCount,
      current: registered,
    });
  }

  return registered;
}

// Read schedule + roleId in one file read (avoid reading the same
// SKILL.md twice). Returns null if no schedule is configured.
function readSkillScheduleInfo(skill: Skill): SkillScheduleInfo | null {
  try {
    const raw = readFileSync(skill.path, "utf-8");
    const parsed = parseSkillFrontmatter(raw);
    const s = parsed?.schedule?.parsed;
    if (!s) return null;
    return {
      schedule: s,
      roleId: parsed?.roleId ?? DEFAULT_ROLE_ID,
    };
  } catch {
    return null;
  }
}
