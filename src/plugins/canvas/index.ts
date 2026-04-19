import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME } from "./definition";
import type { ImageToolData } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";

const canvasPlugin: ToolPlugin<ImageToolData> = {
  toolDefinition,

  async execute(_context, args) {
    const result = await apiPost<ToolResult<ImageToolData>>(
      API_ROUTES.plugins.canvas,
      args,
    );
    if (!result.ok) {
      return {
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
        message: result.error,
      };
    }
    return {
      ...result.data,
      toolName: TOOL_NAME,
      uuid: crypto.randomUUID(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Opening drawing canvas...",
  viewComponent: View,
  previewComponent: Preview,
};

export default canvasPlugin;
export { TOOL_NAME };
