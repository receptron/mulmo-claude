// Shape detector for the legacy `manageScheduler` tool result —
// covers chat sessions in the workspace that were saved before the
// PR #824 split. Pure, no Vue dependency, so the heuristic is
// unit-testable in isolation.
//
// The old `manageScheduler` returned two distinct payload shapes
// depending on which action the LLM had picked:
//
//   Calendar actions (show/add/update/delete):
//     data: { items: ScheduledItem[] }
//
//   Automation actions (createTask/listTasks/deleteTask/runTask):
//     data: { task: ... }            // createTask
//     data: { tasks: [...] }         // listTasks
//     data: { triggered: ..., chatSessionId: ... } // runTask
//     data: { deleted: ... }         // deleteTask
//
// One of the four task-shape keys is enough to discriminate. We
// keep this list narrow on purpose: a future schema change that
// adds new task fields should fail OPEN (default to calendar) so
// reviewers see the mismatch and update the helper, rather than
// silently routing new shapes to the automations view.

import { isRecord } from "../../utils/types";

const TASK_SHAPE_KEYS = ["task", "tasks", "triggered", "deleted"] as const;

export function isLegacyAutomationsShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const key of TASK_SHAPE_KEYS) {
    if (key in value) return true;
  }
  return false;
}
