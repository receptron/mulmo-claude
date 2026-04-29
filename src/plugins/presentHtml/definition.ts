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
        description: [
          "Complete, self-contained HTML string. All CSS and JavaScript must be inline or loaded via CDN.",
          "Must be a full document (include <!DOCTYPE html> and <html>/<body> tags).",
          "",
          "FILE LOCATION: this HTML is saved to `artifacts/html/<YYYY>/<MM>/<slug>-<timestamp>.html`.",
          "",
          "REFERENCING WORKSPACE FILES (images, charts, other artifacts): use RELATIVE paths with exactly three `../` to climb out of `html/<YYYY>/<MM>/`. The generated file must remain portable — the user may open it directly from disk via file://, where absolute URLs do not work.",
          '  GOOD: <img src="../../../images/2026/04/foo.png">',
          '  BAD:  <img src="/artifacts/images/2026/04/foo.png">  (breaks under file://)',
          '  BAD:  <img src="artifacts/images/2026/04/foo.png">    (resolves wrong from html/YYYY/MM/)',
          "Workspace paths returned by other tools (e.g. presentImage returns `artifacts/images/2026/04/foo.png`): replace the leading `artifacts/` with `../../../`, giving `../../../images/2026/04/foo.png`.",
        ].join("\n"),
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
