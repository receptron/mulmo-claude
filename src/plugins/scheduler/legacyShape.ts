// Discriminator for legacy `manageScheduler` tool results saved before the #824 split. List is narrow on purpose:
// a future schema change that adds new task keys must fail OPEN (default to calendar) so reviewers see the mismatch
// rather than silently routing new shapes to automations.

import { isRecord } from "../../utils/types";

const TASK_SHAPE_KEYS = ["task", "tasks", "triggered", "deleted"] as const;

export function isLegacyAutomationsShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const key of TASK_SHAPE_KEYS) {
    if (key in value) return true;
  }
  return false;
}
