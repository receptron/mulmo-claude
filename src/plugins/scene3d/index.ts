import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import type { SceneDocument } from "./schema";

export interface PresentScene3dData {
  document: SceneDocument;
  title?: string;
  filePath: string;
}

const presentScene3dPlugin: ToolPlugin<PresentScene3dData> = {
  toolDefinition,

  async execute(_context, args) {
    const result = await apiPost<ToolResult<PresentScene3dData>>(API_ROUTES.scene3d.present, args);
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
  generatingMessage: "Rendering 3D scene…",
  viewComponent: View,
  previewComponent: Preview,
};

export default presentScene3dPlugin;
export { TOOL_NAME };
