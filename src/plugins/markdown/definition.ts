import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "presentDocument";

export interface MarkdownToolData {
  markdown: string;
  pdfPath?: string;
  filenameHint?: string;
}

/** True when the `markdown` field is a workspace-relative file path
 *  rather than inline content. Covers both the post-#284 canonical
 *  path (`artifacts/documents/*.md`) and the legacy `markdowns/*.md`
 *  prefix for sessions whose jsonl hasn't been migrated yet. */
export function isFilePath(value: string): boolean {
  if (!value.endsWith(".md")) return false;
  return (
    value.startsWith("artifacts/documents/") || value.startsWith("markdowns/")
  );
}

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: "Display a document in markdown format.",
  prompt:
    `Use the ${TOOL_NAME} tool when the user asks for a document that combines text with embedded images — guides, reports, tutorials, articles, or any structured content with visuals. ` +
    `Prefer this over standalone image generation when the user wants informational content with supporting visuals.\n\n` +
    "Format embedded images as: ![Detailed image prompt](__too_be_replaced_image_path__)",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Title for the document",
      },
      markdown: {
        type: "string",
        description:
          "The markdown content to display. Describe embedded images in the following format: ![Detailed image prompt](__too_be_replaced_image_path__). IMPORTANT: For embedded images, you MUST use the EXACT placeholder path '__too_be_replaced_image_path__'.",
      },
      filenameHint: {
        type: "string",
        description:
          "Short English filename for download (without extension). Use lowercase with hyphens, e.g. 'project-summary'. Required when the title is not in ASCII.",
      },
    },
    required: ["title", "markdown"],
  },
};

export default toolDefinition;
