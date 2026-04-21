import type { ToolDefinition } from "gui-chat-protocol";
import { SCHEDULER_ACTIONS } from "../../config/schedulerActions";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: "manageScheduler",
  prompt:
    "When users mention events, appointments, meetings, reminders, or recurring tasks to schedule, use manageScheduler. " +
    "For calendar events use show/add/update/delete. " +
    "For automated recurring tasks (e.g. '毎朝8時にニュースまとめて', 'remind me every day') use createTask/listTasks/deleteTask/runTask. " +
    "Schedule format: { type: 'interval', intervalMs: 3600000 } for hourly, { type: 'daily', time: 'HH:MM' } for daily (UTC).",
  description:
    "Manage a scheduler — calendar events (show/add/update/delete) and automated tasks (createTask/listTasks/deleteTask/runTask). " +
    "Calendar items have a title and properties. Automated tasks have a name, prompt, schedule, and run via the agent on a recurring basis.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: Object.values(SCHEDULER_ACTIONS),
        description: "Action to perform. show/add/delete/update for calendar items. createTask/listTasks/deleteTask/runTask for automated tasks.",
      },
      title: {
        type: "string",
        description: "For 'add': the item title. For 'update': new title (optional).",
      },
      id: {
        type: "string",
        description: "For 'delete', 'update', 'deleteTask', 'runTask': the item/task id.",
      },
      props: {
        type: "object",
        description: "For 'add': initial properties (e.g. { date, time, location }). For 'update': properties to merge in; set a key to null to remove it.",
        additionalProperties: true,
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
