import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "presentHtml";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: "Save and present a complete, self-contained HTML page in the canvas.",
  prompt: `Use ${TOOL_NAME} when the user asks for HTML output, dashboards, custom layouts, or interactive content. The HTML must be a full self-contained document (\`<!DOCTYPE html>\`, \`<html>\`, \`<body>\`) with all CSS / JavaScript inlined or loaded via CDN. Saved to \`artifacts/html/<YYYY>/<MM>/...\`, so when referencing other workspace assets use a relative path with exactly three \`../\` (example: \`<img src="../../../images/2026/04/foo.png">\`). For the full path conventions and rationale, read \`config/helps/presenthtml.md\` in the workspace.`,
  parameters: {
    type: "object",
    properties: {
      html: {
        type: "string",
        description:
          "Complete, self-contained HTML document. See `config/helps/presenthtml.md` for the relative-path conventions when embedding workspace assets (images, charts, etc.).",
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
