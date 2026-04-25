import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "presentDocument";

export interface MarkdownToolData {
  markdown: string;
  pdfPath?: string;
  filenamePrefix?: string;
}

/** True when the `markdown` field is a workspace-relative file path
 *  rather than inline content. Accepts only the canonical
 *  `artifacts/documents/*.md` prefix now that server-side
 *  `isMarkdownPath` agrees. Any legacy `markdowns/*.md` references
 *  in old session JSONL must be migrated via
 *  `scripts/migrate-legacy-artifact-paths.ts` (#773). */
export function isFilePath(value: string): boolean {
  if (!value.endsWith(".md")) return false;
  return value.startsWith("artifacts/documents/");
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
      filenamePrefix: {
        type: "string",
        description:
          "Short English filename prefix (without extension). Use lowercase with hyphens, e.g. 'project-summary'. The server sanitizes the value and appends a random id to prevent collisions.",
      },
    },
    required: ["title", "markdown", "filenamePrefix"],
  },
};

export default toolDefinition;
