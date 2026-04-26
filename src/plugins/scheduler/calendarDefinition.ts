// MCP tool definition for the calendar half of the former
// `manageScheduler` (#824). Keeps the same backend route
// (`/api/scheduler`) — the action enum is just narrowed to the
// calendar-only subset so the LLM's prompt is unambiguous.

import type { ToolDefinition } from "gui-chat-protocol";
import { SCHEDULER_ACTIONS } from "../../config/schedulerActions";

const CALENDAR_ACTIONS = [SCHEDULER_ACTIONS.show, SCHEDULER_ACTIONS.add, SCHEDULER_ACTIONS.update, SCHEDULER_ACTIONS.delete] as const;

const toolDefinition: ToolDefinition = {
  type: "function",
  name: "manageCalendar",
  prompt:
    "When users mention calendar events, appointments, meetings, or one-off reminders that have a date/time, use manageCalendar. " +
    "Use show to display the calendar, add to create an event, update to edit one, delete to remove one. " +
    "For recurring automated tasks driven by a schedule (e.g. 'every morning at 8 fetch news'), use manageAutomations instead.",
  description:
    "Manage the user's calendar — show / add / update / delete dated calendar items. Calendar items have a title and free-form properties (date, time, location, …).",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...CALENDAR_ACTIONS],
        description: "show / add / delete / update.",
      },
      title: {
        type: "string",
        description: "For 'add': the item title. For 'update': new title (optional).",
      },
      id: {
        type: "string",
        description: "For 'delete' and 'update': the calendar item id.",
      },
      props: {
        type: "object",
        description: "For 'add': initial properties (e.g. { date, time, location }). For 'update': properties to merge in; set a key to null to remove it.",
        additionalProperties: true,
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
