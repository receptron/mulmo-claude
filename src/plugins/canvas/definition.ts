import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "openCanvas";

export interface ImageToolData {
  imageData: string;
  prompt: string;
}

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: "Open a drawing canvas for the user to create drawings, sketches, or diagrams.",
  prompt: `When the user asks 'I want to draw an image.', call ${TOOL_NAME} API to open the canvas.`,
  parameters: {
    type: "object",
    properties: {},
    required: [] as string[],
  },
};

export default toolDefinition;

export const executeOpenCanvas = async (imagePath: string) => ({
  message: `Drawing canvas opened. The drawing will be saved to: ${imagePath}`,
  instructions:
    "The drawing canvas is now displayed and the user is about to draw on it. Tell them you can turn their drawing into a photographic image, manga, or any other art style once they're done.",
  title: "Drawing Canvas",
});
