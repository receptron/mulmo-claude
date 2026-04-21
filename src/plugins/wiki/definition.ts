import type { ToolDefinition } from "gui-chat-protocol";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: "manageWiki",
  description:
    "Display wiki content in the canvas — the index catalog, a specific page, the activity log, or a lint report. Call this whenever you want to show wiki content to the user.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["index", "page", "log", "lint_report"],
        description: "'index' = show the page catalog, 'page' = show a single page, 'log' = show activity log, 'lint_report' = run health check.",
      },
      pageName: {
        type: "string",
        description: "For 'page' action: the page title or filename slug to display.",
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
