import type { ToolDefinition } from "gui-chat-protocol";
import { SCHEDULER_ACTIONS } from "../../config/schedulerActions";

const AUTOMATION_ACTIONS = [SCHEDULER_ACTIONS.createTask, SCHEDULER_ACTIONS.listTasks, SCHEDULER_ACTIONS.deleteTask, SCHEDULER_ACTIONS.runTask] as const;

const toolDefinition: ToolDefinition = {
  type: "function",
  name: "manageAutomations",
  prompt:
    "When users want a recurring automated task — something the agent runs on a schedule, not a single calendar event — use manageAutomations. " +
    "Examples: '毎朝8時にニュースまとめて', 'remind me every day', 'run this prompt hourly'. " +
    "Use createTask to register, listTasks to show, deleteTask to remove, runTask to trigger immediately. " +
    "Schedule format: { type: 'interval', intervalMs: 3600000 } for hourly, { type: 'daily', time: 'HH:MM' } for daily (UTC). " +
    "For one-off dated calendar events use manageCalendar instead.",
  description:
    "Manage automated recurring tasks the agent runs on a schedule. " +
    "Create / list / delete / run tasks. Each task has a name, a prompt the agent receives at fire time, a schedule, and an optional roleId.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...AUTOMATION_ACTIONS],
        description: "createTask / listTasks / deleteTask / runTask.",
      },
      id: {
        type: "string",
        description: "For 'deleteTask' and 'runTask': the task id.",
      },
      name: {
        type: "string",
        description: "For 'createTask': the task name.",
      },
      prompt: {
        type: "string",
        description: "For 'createTask': the prompt message sent to the agent when the task fires.",
      },
      schedule: {
        type: "object",
        description: "For 'createTask': { type: 'daily', time: 'HH:MM' } or { type: 'interval', intervalMs: number }. Times are UTC.",
      },
      roleId: {
        type: "string",
        description: "For 'createTask': role to use (default: general).",
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
