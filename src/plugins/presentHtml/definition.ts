import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "presentHtml";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description:
    "Save and present a complete, self-contained HTML page in the canvas. Claude generates the HTML and calls this tool to display it. Use for rich interactive output, dashboards, custom layouts, or any content best expressed as HTML.",
  parameters: {
    type: "object",
    properties: {
      html: {
        type: "string",
        description:
          "Complete, self-contained HTML string. All CSS and JavaScript must be inline or loaded via CDN. Must be a full document (include <!DOCTYPE html> and <html>/<body> tags).",
      },
      title: {
        type: "string",
        description: "Short label shown in the preview sidebar.",
      },
    },
    required: ["html"],
  },
};

export default toolDefinition;
