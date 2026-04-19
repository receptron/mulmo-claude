import type { ToolDefinition } from "gui-chat-protocol";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: "manageScheduler",
  prompt:
    "When users mention events, appointments, meetings, or things to schedule, use manageScheduler to help them track them. Store relevant details (date, time, location, etc.) as props.",
  description:
    "Manage a scheduler — show, add, update, or delete scheduled items. Each item has a title and dynamic properties (e.g. date, time, location, description). Use this whenever the user mentions events, appointments, reminders, or things to schedule.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["show", "add", "delete", "update"],
        description: "Action to perform on the scheduler.",
      },
      title: {
        type: "string",
        description:
          "For 'add': the item title. For 'update': new title (optional).",
      },
      id: {
        type: "string",
        description: "For 'delete' and 'update': the item id.",
      },
      props: {
        type: "object",
        description:
          "For 'add': initial properties (e.g. { date, time, location }). For 'update': properties to merge in; set a key to null to remove it.",
        additionalProperties: true,
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
