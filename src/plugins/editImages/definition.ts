import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "editImages";

export interface ImageToolData {
  imageData: string;
  prompt: string;
}

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: "Edit one or more existing images based on a text prompt. Returns a single new image.",
  prompt: `When the user asks to transform or restyle an existing image (e.g. "turn this into a Ghibli-style image", "combine these two photos"), call ${TOOL_NAME} with the workspace-relative paths of the source images in \`imagePaths\` and the edit instructions in \`prompt\`. Use a single-element array for one image; pass two or more paths to combine multiple images.`,
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Description of the edits to be made to the image(s) in English",
      },
      imagePaths: {
        type: "array",
        items: { type: "string" },
        description:
          'Workspace-relative paths of the source images to edit (e.g. ["artifacts/images/2026/04/abc.png"]). Pass at least one path. Multiple paths are combined into a single result image.',
      },
    },
    required: ["prompt", "imagePaths"],
  },
};

export default toolDefinition;
