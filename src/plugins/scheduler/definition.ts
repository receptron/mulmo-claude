import type { ToolDefinition } from "gui-chat-protocol";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: "manageScheduler",
  description:
    "Manage a scheduler — show, add, update, or delete scheduled items. Each item has a title and dynamic properties (e.g. date, time, location, description). Use this whenever the user mentions events, appointments, reminders, or things to schedule.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "show",
          "add",
          "delete",
          "update",
          "add_ical_source",
          "remove_ical_source",
          "list_ical_sources",
          "sync_ical",
        ],
        description:
          "Action to perform on the scheduler. iCal actions manage external calendar subscriptions (Google Calendar, Outlook, etc.).",
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
      name: {
        type: "string",
        description:
          "For 'add_ical_source': a human-readable label for the calendar (e.g. 'Work Calendar').",
      },
      icalUrl: {
        type: "string",
        description:
          "For 'add_ical_source': the iCal URL to subscribe to (e.g. Google Calendar secret address in iCal format).",
      },
      sourceId: {
        type: "string",
        description:
          "For 'remove_ical_source': the id of the source to remove.",
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
