import type { ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME } from "./definition";
import type { ImageToolData } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";

export const SYSTEM_PROMPT = `When the user asks 'turn this image into ...', call ${TOOL_NAME} API to generate a new image.`;

const editImagePlugin: ToolPlugin<ImageToolData> = {
  toolDefinition,

  async execute(_context, args) {
    try {
      const res = await fetch("/api/edit-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        return {
          toolName: TOOL_NAME,
          uuid: crypto.randomUUID(),
          error: (err as { message?: string }).message ?? res.statusText,
        };
      }
      const result = await res.json();
      return {
        ...result,
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
      };
    } catch (error) {
      return {
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  isEnabled: () => true,
  generatingMessage: "Editing image...",
  systemPrompt: SYSTEM_PROMPT,
  viewComponent: View,
  previewComponent: Preview,
};

export default editImagePlugin;
export { TOOL_NAME };
