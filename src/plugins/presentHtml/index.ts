import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { makeUuid } from "../../utils/id";

export interface PresentHtmlData {
  title?: string;
  filePath: string;
}

const presentHtmlPlugin: ToolPlugin<PresentHtmlData> = {
  toolDefinition,

  async execute(_context, args) {
    const result = await apiPost<ToolResult<PresentHtmlData>>(API_ROUTES.html.present, args);
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
  generatingMessage: "Presenting HTML page…",
  viewComponent: View,
  previewComponent: Preview,
};

export default presentHtmlPlugin;
export { TOOL_NAME };
