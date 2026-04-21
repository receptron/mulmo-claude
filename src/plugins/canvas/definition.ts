import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "openCanvas";

export interface ImageToolData {
  imageData: string;
  prompt: string;
}

export interface CanvasDrawingState {
  brushSize?: number;
  brushColor?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  strokes?: unknown[];
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

export const executeOpenCanvas = async () => {
  return {
    message: "Drawing canvas opened",
    instructions: "Tell the user that you are able to turn the drawing into a photographic image, a manga or any other art style.",
    title: "Drawing Canvas",
  };
};
