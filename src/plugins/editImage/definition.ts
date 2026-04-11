import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "editImage";

export interface ImageToolData {
  imageData: string;
  prompt: string;
}

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: "Edit the previously generated image based on a text prompt.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Description of the edits to be made to the image in English",
      },
    },
    required: ["prompt"],
  },
};

export default toolDefinition;
