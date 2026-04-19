import type { ToolDefinition } from "gui-chat-protocol";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: "manageTodoList",
  prompt:
    "When users mention tasks, things to do, or ask about their todo list, use manageTodoList to help them track items.",
  description:
    "Manage a todo list — show items, add, update, check/uncheck, or delete them. Items can optionally carry labels (tags) for categorisation; use labels to group related todos (e.g. 'Work', 'Groceries', 'Urgent') and filter the list at read time.",
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
          "check",
          "uncheck",
          "clear_completed",
          "add_label",
          "remove_label",
          "list_labels",
        ],
        description: "Action to perform on the todo list.",
      },
      text: {
        type: "string",
        description:
          "For 'add': the todo item text. For 'delete', 'update', 'check', 'uncheck', 'add_label', 'remove_label': partial text to find the item.",
      },
      newText: {
        type: "string",
        description: "For 'update' only: the replacement text.",
      },
      note: {
        type: "string",
        description:
          "For 'add' or 'update': an optional note or extra detail for the item.",
      },
      labels: {
        type: "array",
        items: { type: "string" },
        description:
          "For 'add': labels to tag the new item with. For 'add_label' / 'remove_label': labels to add to / remove from the item matched by 'text'. Labels are case-insensitive for matching but stored with their original case.",
      },
      filterLabels: {
        type: "array",
        items: { type: "string" },
        description:
          "For 'show' only: return only items that have at least one of these labels (OR semantics, case-insensitive). Omit to show all items.",
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
