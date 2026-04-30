import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME } from "./definition";
import type { ImageToolData } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { makeUuid } from "../../utils/id";

const editImagesPlugin: ToolPlugin<ImageToolData> = {
  toolDefinition,

  async execute(_context, args) {
    const result = await apiPost<ToolResult<ImageToolData>>(API_ROUTES.image.edit, args);
    if (!result.ok) {
      return {
        toolName: TOOL_NAME,
        uuid: makeUuid(),
        message: result.error,
      };
    }
    return {
      ...result.data,
      toolName: TOOL_NAME,
      uuid: makeUuid(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Editing images...",
  viewComponent: View,
  previewComponent: Preview,
};

export default editImagesPlugin;
export { TOOL_NAME };
